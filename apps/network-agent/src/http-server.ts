import express from "express";
import type { NetworkAgentAdmitCommand, NetworkAgentRevokeCommand } from "@netcam/shared";
import { config } from "./config";
import * as nft from "./nft";
import * as tc from "./tc";
import { admitted } from "./state";

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
      const router = config.routerVlans.find((r) => r.routerId === body.routerId);
      if (!router) {
        res.status(400).json({ ok: false, error: `Unknown routerId ${body.routerId} (not in ROUTER_VLANS)` });
        return;
      }

      const expiresAt = new Date(body.sessionExpiresAt).getTime();
      const timeoutSeconds = Math.max(60, Math.ceil((expiresAt - Date.now()) / 1000));

      await nft.admitMac(body.macAddress, timeoutSeconds);
      await tc.applyShapingForMac(router, body.macAddress, body.downKbps, body.upKbps);

      admitted.set(body.macAddress.toUpperCase(), {
        mac: body.macAddress.toUpperCase(),
        router,
        sessionExpiresAt: expiresAt,
        lastDownBytes: 0,
        lastUpBytes: 0,
      });

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/revoke", async (req, res) => {
    const body = req.body as NetworkAgentRevokeCommand;
    try {
      const entry = admitted.get(body.macAddress.toUpperCase());
      await nft.revokeMac(body.macAddress).catch(() => undefined);
      if (entry) {
        await tc.removeShapingForMac(entry.router, body.macAddress).catch(() => undefined);
      }
      admitted.delete(body.macAddress.toUpperCase());
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true, admittedCount: admitted.size }));

  return app;
}
