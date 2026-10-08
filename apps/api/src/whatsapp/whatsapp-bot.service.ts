import { Injectable, Logger } from "@nestjs/common";
import { VoucherStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CustomersService } from "../customers/customers.service";
import { AlertsService } from "../alerts/alerts.service";
import { WhatsAppHubService } from "./whatsapp-hub.service";
import { WhatsAppClaudeService } from "./whatsapp-claude.service";

export interface HubEvent {
  event: string;
  reason?: string;
  conversation?: { id: string; phoneNumber: string; displayName?: string | null };
  message?: { type?: string; content?: string; interactive?: { id?: string } };
}

const MENU = [
  { id: "my_voucher", title: "My WiFi code" },
  { id: "prices", title: "Prices" },
  { id: "support", title: "Talk to support" },
];

function remaining(expiresAt: Date | null): string {
  if (!expiresAt) return "no time limit";
  const mins = Math.round((expiresAt.getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "expired";
  return mins >= 120 ? `${Math.round(mins / 60)} hours left` : `${mins} minutes left`;
}

/**
 * NetCam's entry in the shared WhatsApp number's app menu. Customers who
 * pick "NetCam WiFi" can look up their codes, see prices, or ask for a
 * human (which alerts the assigned staff; agents answer from the hub console).
 */
@Injectable()
export class WhatsAppBotService {
  private readonly logger = new Logger(WhatsAppBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly hub: WhatsAppHubService,
    private readonly alerts: AlertsService,
    private readonly claude: WhatsAppClaudeService,
  ) {}

  async handle(e: HubEvent): Promise<void> {
    const conversationId = e.conversation?.id;
    const phone = e.conversation?.phoneNumber;
    if (!conversationId || !phone) return;

    if (this.claude.handles(phone)) {
      // A conversation also "starts" with a real message when the hub routes
      // it here directly (default app, support link); only a pick from the
      // hub's app menu carries no request.
      if (e.event === "conversation.started" && e.reason === "user_selected_app") {
        void this.claude
          .handle(conversationId, "menu")
          .catch((err) => this.logger.error(`Claude menu failed: ${(err as Error).message}`));
      } else if (e.event === "message.received" || e.event === "conversation.started") {
        void this.claude
          .handle(conversationId, e.message?.content, e.message?.interactive?.id ?? undefined)
          .catch((err) => this.logger.error(`Claude reply failed: ${(err as Error).message}`));
      }
      return;
    }

    if (e.event === "conversation.started") {
      await this.menu(conversationId, "Welcome to NetCam WiFi. What do you need?");
      return;
    }
    if (e.event !== "message.received") return;

    const choice = e.message?.interactive?.id ?? (e.message?.content ?? "").trim().toLowerCase();
    if (choice === "my_voucher" || /\b(code|voucher|balance|time|left)\b/.test(choice)) {
      await this.voucherStatus(conversationId, phone);
    } else if (choice === "prices" || /\b(price|prices|buy|package|cost)\b/.test(choice)) {
      await this.prices(conversationId);
    } else if (choice === "support" || /\b(support|agent|human|help|problem)\b/.test(choice)) {
      await this.hub.reply(conversationId, {
        type: "text",
        message: "Thanks, a NetCam team member will reply here shortly.",
      });
      await this.alerts.notify({
        category: "CUSTOMERS",
        severity: "WARNING",
        title: "Customer asking for help on WhatsApp",
        message: `${e.conversation?.displayName ?? "A customer"} (+${phone}) wants to talk to support. Reply from the WhatsApp hub console.`,
        dedupeKey: `wa-support:${phone}`,
        cooldownMinutes: 30,
      });
    } else {
      await this.menu(conversationId, "Choose an option:");
    }
  }

  private async menu(conversationId: string, body: string) {
    await this.hub.reply(conversationId, { type: "buttons", body, buttons: MENU });
  }

  private async voucherStatus(conversationId: string, phone: string) {
    const customer = await this.customers.findByPhone(phone).catch(() => null);
    const vouchers = customer
      ? await this.prisma.voucher.findMany({
          where: { customerId: customer.id, status: { in: [VoucherStatus.ACTIVE, VoucherStatus.UNUSED] } },
          include: { package: true },
          orderBy: { createdAt: "desc" },
          take: 3,
        })
      : [];

    if (vouchers.length === 0) {
      await this.menu(conversationId, "There's no active WiFi code for this number. Tap Prices to see packages.");
      return;
    }

    const lines = vouchers.map((v) => {
      const state =
        v.status === VoucherStatus.UNUSED
          ? "not used yet, starts when you connect"
          : `${remaining(v.expiresAt)}${
              v.package.dataCapMb ? `, ${Math.max(0, Math.round(v.package.dataCapMb - v.dataUsedMb))} MB left` : ""
            }`;
      return `${v.code}: ${v.package.name}, ${state}`;
    });
    await this.hub.reply(conversationId, {
      type: "text",
      message: `Your WiFi codes:\n${lines.join("\n")}\n\nEnter a code on the WiFi login page if you're not connected.`,
    });
  }

  private async prices(conversationId: string) {
    const packages = await this.prisma.package.findMany({ where: { isActive: true }, orderBy: { priceUgx: "asc" } });
    const lines = packages.map((p) => `${p.name}: UGX ${p.priceUgx.toLocaleString("en-US")}`);
    await this.hub.reply(conversationId, {
      type: "text",
      message: `NetCam WiFi packages:\n${lines.join("\n")}\n\nTo buy, connect to the NetCam WiFi and open any website. Pay with Mobile Money and you're online automatically.`,
    });
  }
}
