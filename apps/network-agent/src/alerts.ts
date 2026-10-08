import axios from "axios";
import { apiClient } from "./api-client";

export type Severity = "INFO" | "WARNING" | "CRITICAL";

export interface AgentAlert {
  category: "NETWORK" | "POWER" | "SYSTEM";
  severity: Severity;
  title: string;
  message: string;
  dedupeKey?: string;
  cooldownMinutes?: number;
}

// Used only when the API can't be reached, so a dead API (or database) still
// gets reported. Recipients and preferences live in the API normally.
const hubUrl = (process.env.WHATSAPP_HUB_URL ?? "").replace(/\/+$/, "");
const hubKey = process.env.WHATSAPP_HUB_API_KEY ?? "";
const hubTemplate = process.env.WHATSAPP_HUB_TEMPLATE ?? "general_app_update";
const fallbackPhones = (process.env.ALERT_FALLBACK_PHONES ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => /^256\d{9}$/.test(p));
const fallbackSentAt = new Map<string, number>();

// The hub's template contract caps every parameter at 200 characters.
function flat(value: string, max = 200) {
  const v = value.replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").trim();
  if (v.length <= max) return v;
  const cut = v.slice(0, max - 1);
  const end = cut.lastIndexOf(". ");
  return end > max * 0.6 ? cut.slice(0, end + 1) : `${cut}…`;
}

async function sendDirect(a: AgentAlert): Promise<void> {
  if (!hubUrl || !hubKey || fallbackPhones.length === 0 || a.severity !== "CRITICAL") return;
  const key = a.dedupeKey ?? a.title;
  const last = fallbackSentAt.get(key) ?? 0;
  if (Date.now() - last < (a.cooldownMinutes ?? 30) * 60_000) return;
  fallbackSentAt.set(key, Date.now());

  await Promise.all(
    fallbackPhones.map((phoneNumber) =>
      axios
        .post(
          `${hubUrl}/v1/integrations/templates/send`,
          {
            phoneNumber,
            templateName: hubTemplate,
            languageCode: "en_US",
            variables: { body: ["Admin", "NetCam WiFi", flat(`URGENT: ${a.title}`, 60), flat(a.message)] },
          },
          { headers: { "X-API-Key": hubKey }, timeout: 15_000 },
        )
        .catch((err) => console.warn(`direct WhatsApp alert to ${phoneNumber} failed: ${(err as Error).message}`)),
    ),
  );
}

/** Reports through the API (recipients, preferences, history); straight to WhatsApp if the API is down. */
export async function raiseAlert(a: AgentAlert): Promise<void> {
  try {
    await apiClient.post("/api/network-agent/alert", a);
  } catch (err) {
    console.warn(`alert "${a.title}" could not reach the API (${(err as Error).message}); sending directly`);
    await sendDirect(a);
  }
}

/** For when the API itself has stopped answering. */
export const sendDirectAlert = sendDirect;
