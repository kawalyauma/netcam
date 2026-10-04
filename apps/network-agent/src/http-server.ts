import express from "express";
import type { NetworkAgentAdmitCommand, NetworkAgentRevokeCommand } from "@netcam/shared";
import { config } from "./config";
import { admitted } from "./state";
import { admitDevice, revokeDevice } from "./admission";
import { collectNetworkStatus, type RouterProbe } from "./network-status";
import { usageSnapshot } from "./usage";
import { isPresent } from "./arp";

export function createHttpServer() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (req.headers["x-netcam-secret"] !== config.sharedSecret) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    next();
  });

  app.post("/admit", async (req, res) => {
    const body = req.body as NetworkAgentAdmitCommand;
    try {
      // Forced: the API only calls this when it wants the device online now
      // (login, payment, portal open), so always rewrite the firewall entry.
      const ok = await admitDevice(body, true);
      if (!ok) {
        res.status(400).json({ ok: false, error: `No configured router segment for routerId "${body.routerId}" / IP ${body.ipAddress}` });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/revoke", async (req, res) => {
    const body = req.body as NetworkAgentRevokeCommand;
    try {
      await revokeDevice(body.macAddress);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/network-status", async (req, res) => {
    try {
      const routers = Array.isArray(req.body?.routers) ? (req.body.routers as RouterProbe[]) : [];
      res.json(await collectNetworkStatus(routers));
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/presence", async (req, res) => {
    try {
      res.json({ present: await isPresent(String(req.body?.macAddress ?? ""), req.body?.ipAddress ?? null) });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get("/usage/live",(_req, res) => res.json(usageSnapshot()));

  app.get("/healthz",(_req, res) => res.json({ ok: true, admittedCount: admitted.size }));

  return app;
}
