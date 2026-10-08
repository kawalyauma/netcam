import express, { type Request, type Response } from "express";
import path from "path";
import axios from "axios";
import { config, findRouter } from "./config";
import { resolveMacFromIp } from "./arp";
import { readLeases } from "./dnsmasq";

// Carries the shared secret: the API only accepts MAC-bearing portal calls
// from this proxy, never straight from the internet.
const api = axios.create({
  baseURL: config.apiUrl,
  timeout: 15_000,
  headers: { "x-netcam-secret": config.sharedSecret },
  validateStatus: () => true,
});

function clientIp(req: Request): string {
  return (req.socket.remoteAddress ?? "").replace("::ffff:", "");
}

/** Identifies the device behind a request from the TCP source IP via ARP — the browser is never trusted with this. */
async function deviceFor(req: Request) {
  const ip = clientIp(req);
  const macAddress = await resolveMacFromIp(ip).catch(() => null);
  if (!macAddress) return null;
  const localAddress = (req.socket.localAddress ?? "").replace("::ffff:", "");
  const router = config.routerVlans.find((r) => r.gatewayIp === localAddress) ?? findRouter(undefined, ip);
  const lease = (await readLeases(config.routerVlans).catch(() => [])).find((l) => l.macAddress === macAddress);
  return {
    macAddress,
    ipAddress: ip,
    routerId: router?.routerId,
    routerVlanId: router?.vlanId ?? undefined,
    hostname: lease?.hostname,
  };
}

function apiUnavailable(res: Response) {
  res.status(503).json({ ok: false, message: "The WiFi system is starting up. Please try again in a minute." });
}

/**
 * Public, unauthenticated router served to LAN clients on PORTAL_PORT,
 * proxying to the main API's /api/portal/* endpoints.
 */
export function createPortalRouter() {
  const router = express.Router();
  router.use(express.json());

  router.get("/packages", async (_req, res) => {
    try {
      const { data, status } = await api.get("/api/packages", { params: { activeOnly: "true" } });
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
  });

  router.post("/pay", async (req, res) => {
    try {
      // Remember which device is paying, so it gets logged in when the
      // payment lands even if the customer has closed this page by then.
      const device = await deviceFor(req);
      const { data, status } = await api.post("/api/portal/pay", {
        packageId: req.body.packageId,
        phoneNumber: req.body.phoneNumber,
        macAddress: device?.macAddress,
        ipAddress: device?.ipAddress,
        routerId: device?.routerId,
      });
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
  });

  router.get("/pay/:paymentId/status", async (req, res) => {
    try {
      const { data, status } = await api.get(`/api/portal/pay/${encodeURIComponent(req.params.paymentId)}/status`);
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
  });

  router.post("/redeem", async (req, res) => {
    const device = await deviceFor(req);
    if (!device) {
      res.status(400).json({ ok: false, message: "Could not identify your device on the network. Try reconnecting to WiFi and retry." });
      return;
    }
    try {
      const { data, status } = await api.post("/api/portal/redeem", {
        voucherCode: req.body.voucherCode,
        ...device,
        userAgent: req.headers["user-agent"],
      });
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
  });

  /** Launch promo: one-tap free connect — identifies the device by ARP, same as /redeem. */
  router.post("/free-connect", async (req, res) => {
    const device = await deviceFor(req);
    if (!device) {
      res.status(400).json({ ok: false, message: "Could not identify your device on the network. Try reconnecting to WiFi and retry." });
      return;
    }
    try {
      const { data, status } = await api.post("/api/portal/free-connect", {
        macAddress: device.macAddress,
        ipAddress: device.ipAddress,
        routerId: device.routerId,
        hostname: device.hostname,
      });
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
  });

  /** Also logs the device back in when it's entitled (e.g. after the box rebooted). */
  router.get("/status", async (req, res) => {
    const device = await deviceFor(req);
    if (!device) {
      res.json({ authorized: false });
      return;
    }
    try {
      const { data, status } = await api.post("/api/portal/status", {
        macAddress: device.macAddress,
        ipAddress: device.ipAddress,
        routerId: device.routerId,
        hostname: device.hostname,
      });
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
  });

  router.post("/recover", async (req, res) => {
    try {
      const { data, status } = await api.post("/api/portal/recover", req.body);
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
  });

  router.post("/recover/confirm", async (req, res) => {
    try {
      const { data, status } = await api.post("/api/portal/recover/confirm", req.body);
      res.status(status).json(data);
    } catch {
      apiUnavailable(res);
    }
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
  // Captive-portal detection: unauthorized clients' port-80 traffic is DNAT'd
  // here, so OS probes (captive.apple.com/hotspot-detect.html, */generate_204,
  // ...) land on unknown paths. A 404 reads as "no internet" to Android and is
  // unreliable on iOS; a no-cache 302 to the portal is what makes the sign-in
  // sheet pop up.
  app.use((req, res) => {
    const host = (req.socket.localAddress ?? "").replace("::ffff:", "");
    res.set("Cache-Control", "no-store");
    res.redirect(302, `http://${host}:${req.socket.localPort}/`);
  });
  return app;
}
