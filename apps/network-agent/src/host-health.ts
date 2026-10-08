import { readdir, readFile, statfs } from "fs/promises";
import { config } from "./config";
import { run } from "./shell";
import { raiseAlert, sendDirectAlert } from "./alerts";
import { apiClient } from "./api-client";

const CHECK_MS = 30_000;
const INTERNET_FAILURES_BEFORE_ALERT = 2;
const API_FAILURES_BEFORE_ALERT = 4; // 2 minutes
const DISK_FREE_WARN_RATIO = 0.1;
const HOT_CELSIUS = 90;

interface PowerState {
  onMains: boolean | null; // null = no AC adapter reported (desktop with no battery)
  batteryPercent: number | null;
}

async function readSys(path: string): Promise<string | null> {
  return readFile(path, "utf8").then((v) => v.trim()).catch(() => null);
}

async function readPower(): Promise<PowerState> {
  const supplies = await readdir("/sys/class/power_supply").catch(() => [] as string[]);
  let onMains: boolean | null = null;
  let batteryPercent: number | null = null;
  for (const s of supplies) {
    const type = await readSys(`/sys/class/power_supply/${s}/type`);
    if (type === "Mains") onMains = (onMains ?? false) || (await readSys(`/sys/class/power_supply/${s}/online`)) === "1";
    if (type === "Battery") {
      const capacity = Number(await readSys(`/sys/class/power_supply/${s}/capacity`));
      if (Number.isFinite(capacity)) batteryPercent = capacity;
    }
  }
  return { onMains, batteryPercent };
}

// Real web requests, not ping: mobile networks often drop ICMP while
// browsing works fine, which made ping report outages that weren't there.
const CONNECTIVITY_CHECKS = ["http://connectivitycheck.gstatic.com/generate_204", "https://1.1.1.1/cdn-cgi/trace"];

async function internetReachable(): Promise<boolean> {
  for (const url of CONNECTIVITY_CHECKS) {
    const ok = await run("curl", ["--interface", config.wanInterface, "-s", "-m", "6", "-o", "/dev/null", "-w", "%{http_code}", url]).then(
      ({ stdout }) => /^(2\d\d)$/.test(stdout.trim()),
      () => false,
    );
    if (ok) return true;
  }
  return false;
}

async function maxTemperature(): Promise<number | null> {
  const zones = await readdir("/sys/class/thermal").catch(() => [] as string[]);
  let max: number | null = null;
  for (const z of zones.filter((z) => z.startsWith("thermal_zone"))) {
    const milli = Number(await readSys(`/sys/class/thermal/${z}/temp`));
    if (Number.isFinite(milli) && milli > 0) max = Math.max(max ?? 0, milli / 1000);
  }
  return max;
}

function minutesSince(t: number) {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * Watches what only the gateway machine can see and reports state changes:
 * power cuts (laptop on battery), the internet uplink, the API itself,
 * disk space and temperature.
 */
export function startHostHealthMonitor(): void {
  let power: PowerState | null = null;
  let internetUp = true;
  let internetFailures = 0;
  let internetDownSince = 0;
  let apiFailures = 0;
  let apiDownSince = 0;
  let checking = false;

  const check = async () => {
    // Power
    const now = await readPower();
    if (power && now.onMains !== null && power.onMains !== now.onMains) {
      await raiseAlert(
        now.onMains
          ? { category: "POWER", severity: "INFO", title: "Power restored", message: `Mains power is back. Battery at ${now.batteryPercent ?? "?"}%.` }
          : {
              category: "POWER",
              severity: "CRITICAL",
              title: "Power cut",
              message: `The gateway lost mains power and is running on battery (${now.batteryPercent ?? "?"}%). The router needs power too, or customers are offline.`,
              dedupeKey: "power-cut",
              cooldownMinutes: 10,
            },
      );
    }
    if (now.onMains === false && now.batteryPercent !== null) {
      for (const level of [30, 15, 7]) {
        if (now.batteryPercent <= level) {
          await raiseAlert({
            category: "POWER",
            severity: level === 30 ? "WARNING" : "CRITICAL",
            title: `Battery at ${now.batteryPercent}%`,
            message:
              level === 7
                ? "The gateway is about to shut down. Restore power now; it will come back on its own when powered."
                : `Still no mains power. The gateway will shut down when the battery runs out.`,
            dedupeKey: `battery-${level}`,
            cooldownMinutes: 6 * 60,
          });
          break;
        }
      }
    }
    power = now;

    // Internet uplink
    const reachable = await internetReachable();
    if (reachable) {
      if (!internetUp) {
        await raiseAlert({
          category: "NETWORK",
          severity: "INFO",
          title: "Internet is back",
          message: `The internet uplink (${config.wanInterface}) recovered after ${minutesSince(internetDownSince)}.`,
        });
      }
      internetUp = true;
      internetFailures = 0;
    } else if (++internetFailures >= INTERNET_FAILURES_BEFORE_ALERT && internetUp) {
      internetUp = false;
      internetDownSince = Date.now() - INTERNET_FAILURES_BEFORE_ALERT * CHECK_MS;
      // Delivered only if another route out still works (e.g. the laptop's
      // own WiFi); otherwise the "back" message reports the outage length.
      await raiseAlert({
        category: "NETWORK",
        severity: "CRITICAL",
        title: "Internet is down",
        message: `The gateway can't reach the internet through ${config.wanInterface}. Check the LTE router's power, signal and data bundle, and the cable to the gateway.`,
        dedupeKey: "internet-down",
        cooldownMinutes: 30,
      });
    }

    // The API (and its database). Its own alerts can't report its death.
    const apiOk = await apiClient.get("/api/health", { timeout: 5000 }).then(
      () => true,
      () => false,
    );
    if (apiOk) {
      if (apiFailures >= API_FAILURES_BEFORE_ALERT) {
        await raiseAlert({
          category: "SYSTEM",
          severity: "INFO",
          title: "NetCam API recovered",
          message: `Payments and the dashboard are working again after ${minutesSince(apiDownSince)}.`,
        });
      }
      apiFailures = 0;
    } else if (++apiFailures === API_FAILURES_BEFORE_ALERT) {
      apiDownSince = Date.now() - API_FAILURES_BEFORE_ALERT * CHECK_MS;
      await sendDirectAlert({
        category: "SYSTEM",
        severity: "CRITICAL",
        title: "NetCam API is down",
        message: "Payments, the portal and the dashboard are not responding. Paid customers keep internet. Docker restarts it automatically; if this lasts, restart the gateway.",
        dedupeKey: "api-down",
        cooldownMinutes: 60,
      });
    }

    // Disk
    const fs = await statfs("/").catch(() => null);
    if (fs && fs.bavail / fs.blocks < DISK_FREE_WARN_RATIO) {
      await raiseAlert({
        category: "SYSTEM",
        severity: "WARNING",
        title: "Disk almost full",
        message: `Only ${Math.round((fs.bavail / fs.blocks) * 100)}% disk space left on the gateway. The database stops working when it fills up.`,
        dedupeKey: "disk-low",
        cooldownMinutes: 12 * 60,
      });
    }

    // Temperature
    const temp = await maxTemperature();
    if (temp !== null && temp >= HOT_CELSIUS) {
      await raiseAlert({
        category: "SYSTEM",
        severity: "WARNING",
        title: "Gateway overheating",
        message: `CPU at ${Math.round(temp)}°C. Make sure the vents aren't blocked; overheating machines shut down without warning.`,
        dedupeKey: "overheating",
        cooldownMinutes: 60,
      });
    }
  };

  setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      await check();
    } catch (err) {
      console.warn(`host health check failed: ${(err as Error).message}`);
    } finally {
      checking = false;
    }
  }, CHECK_MS);
}

/** Tells someone the gateway (re)started — after a power cut this is the first sign it's back. */
export async function announceStartup(): Promise<void> {
  const uptimeSeconds = Number((await readSys("/proc/uptime"))?.split(" ")[0] ?? 0);
  const rebooted = uptimeSeconds < 15 * 60;
  await raiseAlert({
    category: rebooted ? "POWER" : "SYSTEM",
    severity: rebooted ? "WARNING" : "INFO",
    title: rebooted ? "Gateway rebooted" : "Network agent restarted",
    message: rebooted
      ? "The gateway machine just started up (power cut, crash or manual restart). Paid customers have been reconnected."
      : "The network agent restarted; paid customers have been reconnected.",
    dedupeKey: rebooted ? "gateway-boot" : "agent-restart",
    cooldownMinutes: 10,
  });
}
