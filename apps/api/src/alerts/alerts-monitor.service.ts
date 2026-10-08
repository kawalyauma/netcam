import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { NetworkAgentBridgeService } from "../network-agent-bridge/network-agent-bridge.service";
import { AlertsService } from "./alerts.service";

const ROUTER_ONLINE_WINDOW_MS = 3 * 60_000;
const AGENT_FAILURES_BEFORE_ALERT = 2;

/** Watches things that fail silently and turns state changes into alerts. */
@Injectable()
export class AlertsMonitorService {
  // Last known state. Empty after an API restart, so the first look only
  // records state instead of announcing everything as "just went offline".
  private readonly routerOnline = new Map<string, boolean>();
  private agentFailures = 0;
  private agentDownAlerted = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: NetworkAgentBridgeService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkRouters() {
    const now = Date.now();
    const routers = await this.prisma.router.findMany({ select: { id: true, name: true, lastSeenAt: true } });
    for (const r of routers) {
      const online = Boolean(r.lastSeenAt && now - r.lastSeenAt.getTime() <= ROUTER_ONLINE_WINDOW_MS);
      const before = this.routerOnline.get(r.id);
      this.routerOnline.set(r.id, online);
      if (before === undefined || before === online) continue;

      await this.alerts.notify(
        online
          ? {
              category: "NETWORK",
              severity: "INFO",
              title: `${r.name} is back online`,
              message: `${r.name} is connected again and serving customers.`,
            }
          : {
              category: "NETWORK",
              severity: "CRITICAL",
              title: `${r.name} is offline`,
              message: `No contact with ${r.name} for 3 minutes. Check its power and the cable to the gateway. Customers on it have no internet.`,
              dedupeKey: `router-offline:${r.id}`,
              cooldownMinutes: 15,
            },
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAgent() {
    const healthy = await this.agent.isHealthy();
    if (healthy) {
      if (this.agentDownAlerted) {
        await this.alerts.notify({
          category: "SYSTEM",
          severity: "INFO",
          title: "Network agent recovered",
          message: "The gateway's network agent is responding again; customers can log in.",
        });
      }
      this.agentFailures = 0;
      this.agentDownAlerted = false;
      return;
    }

    this.agentFailures++;
    if (this.agentFailures >= AGENT_FAILURES_BEFORE_ALERT && !this.agentDownAlerted) {
      this.agentDownAlerted = true;
      await this.alerts.notify({
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "Network agent not responding",
        message:
          "The gateway's network agent has not answered for 2 minutes. New customers can't log in and paid ones may lose access. It restarts automatically; if this repeats, restart the gateway.",
        dedupeKey: "agent-down",
        cooldownMinutes: 60,
      });
    }
  }

  /** SMS failures are otherwise only visible in the logs. */
  @Cron("*/10 * * * *")
  async checkSmsFailures() {
    const since = new Date(Date.now() - 10 * 60_000);
    const failed = await this.prisma.smsLog.findMany({
      where: { status: "FAILED", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (failed.length === 0) return;
    await this.alerts.notify({
      category: "SYSTEM",
      severity: "WARNING",
      title: "SMS sending is failing",
      message: `${failed.length} SMS failed in the last 10 minutes. Latest error: ${failed[0].error ?? "unknown"}. Check the EGO SMS balance and sender ID.`,
      dedupeKey: "sms-failing",
      cooldownMinutes: 120,
    });
  }
}
