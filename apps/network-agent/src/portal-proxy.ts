import express, { type Request } from "express";
import path from "path";
import axios from "axios";
import { config } from "./config";
import { resolveMacFromIp } from "./arp";

const api = axios.create({ baseURL: config.apiUrl, timeout: 10_000 });

function routerForRequest(req: Request) {
  const localAddress = (req.socket.localAddress ?? "").replace("::ffff:", "");
  return config.routerVlans.find((r) => r.gatewayIp === localAddress);
}

function clientIp(req: Request): string {
  return (req.socket.remoteAddress ?? "").replace("::ffff:", "");
}

/**
 * Public, unauthenticated router served to LAN clients on PORTAL_PORT. It
 * proxies to the main API's /api/portal/* endpoints, but for anything that
 * needs to know WHICH DEVICE is asking, it resolves the MAC itself from the
 * TCP connection's source IP via ARP — the browser is never asked for one.
 */
export function createPortalRouter() {
  const router = express.Router();
  router.use(express.json());

  router.get("/packages", async (_req, res) => {
    const { data } = await api.get("/api/packages", { params: { activeOnly: "true" } });
    res.json(data);
  });

  router.post("/pay", async (req, res) => {
    const { data, status } = await api.post("/api/portal/pay", req.body, { validateStatus: () => true });
    res.status(status).json(data);
  });

  router.get("/pay/:paymentId/status", async (req, res) => {
    const { data, status } = await api.get(`/api/portal/pay/${req.params.paymentId}/status`, {
      validateStatus: () => true,
    });
    res.status(status).json(data);
  });

  router.post("/redeem", async (req, res) => {
    const ip = clientIp(req);
    const mac = await resolveMacFromIp(ip);
    if (!mac) {
      res.status(400).json({ ok: false, message: "Could not identify your device on the network. Try reconnecting to WiFi and retry." });
      return;
    }
    const routerVlan = routerForRequest(req);
    const { data, status } = await api.post(
      "/api/portal/redeem",
      {
        voucherCode: req.body.voucherCode,
        macAddress: mac,
        ipAddress: ip,
        routerVlanId: routerVlan?.vlanId,
        userAgent: req.headers["user-agent"],
      },
      { validateStatus: () => true },
    );
    res.status(status).json(data);
  });

  router.get("/status", async (req, res) => {
    const mac = await resolveMacFromIp(clientIp(req));
    if (!mac) {
      res.json({ authorized: false });
      return;
    }
    const { data } = await api.get("/api/portal/status", { params: { mac } });
    res.json(data);
  });

  router.post("/recover", async (req, res) => {
    const { data, status } = await api.post("/api/portal/recover", req.body, { validateStatus: () => true });
    res.status(status).json(data);
  });

  router.post("/recover/confirm", async (req, res) => {
    const { data, status } = await api.post("/api/portal/recover/confirm", req.body, { validateStatus: () => true });
    res.status(status).json(data);
  });

  return router;
}

export function createPortalApp() {
  const app = express();
  app.use("/portal", createPortalRouter());
  // apps/portal's production build (`pnpm --filter @netcam/portal build`) — a
  // small static bundle so the captive-portal page loads fast even on a
  // weak connection.
  app.use(express.static(path.join(__dirname, "..", "..", "portal", "dist")));
  return app;
}
