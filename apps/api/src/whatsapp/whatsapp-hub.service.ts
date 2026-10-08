import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

export interface SendResult {
  ok: boolean;
  error?: string;
}

// The hub's template contract caps every parameter at 200 characters.
const PARAM_MAX = 200;

// WhatsApp rejects template parameters containing newlines, tabs or more
// than four consecutive spaces. Long text is cut at a sentence boundary.
export function templateSafe(value: string, max = PARAM_MAX): string {
  const flat = value.replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const sentenceEnd = cut.lastIndexOf(". ");
  return sentenceEnd > max * 0.6 ? cut.slice(0, sentenceEnd + 1) : `${cut}…`;
}

function describe(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { error?: { message?: string } } | undefined;
    return body?.error?.message ?? `${err.response?.status ?? ""} ${err.message}`.trim();
  }
  return (err as Error).message;
}

/**
 * Client for the shared WhatsApp Support Hub (a separate Cloudflare Worker
 * that owns the WhatsApp number). NetCam is one "application" on it,
 * authenticated with its own API key. Unconfigured = every send reports
 * failure, so callers fall back to SMS.
 */
@Injectable()
export class WhatsAppHubService {
  private readonly logger = new Logger(WhatsAppHubService.name);
  private readonly baseUrl = (process.env.WHATSAPP_HUB_URL ?? "").replace(/\/+$/, "");
  private readonly apiKey = process.env.WHATSAPP_HUB_API_KEY ?? "";
  private readonly template = process.env.WHATSAPP_HUB_TEMPLATE ?? "general_app_update";
  private readonly language = process.env.WHATSAPP_HUB_TEMPLATE_LANGUAGE ?? "en_US";
  readonly appName = process.env.WHATSAPP_HUB_APP_NAME ?? "NetCam WiFi";

  get configured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /**
   * Business-initiated message via the hub's approved general template, so
   * it reaches people who haven't messaged the number in the last 24h.
   */
  async sendUpdate(phoneDigits: string, p: { name?: string | null; subject: string; message: string }): Promise<SendResult> {
    if (!this.configured) return { ok: false, error: "WhatsApp hub not configured" };
    try {
      await axios.post(
        `${this.baseUrl}/v1/integrations/templates/send`,
        {
          phoneNumber: phoneDigits,
          templateName: this.template,
          languageCode: this.language,
          variables: {
            body: [
              templateSafe(p.name || "there", 80),
              templateSafe(this.appName, 50),
              templateSafe(p.subject, 60),
              templateSafe(p.message),
            ],
          },
        },
        { headers: { "X-API-Key": this.apiKey }, timeout: 15_000 },
      );
      return { ok: true };
    } catch (err) {
      const error = describe(err);
      this.logger.warn(`WhatsApp to ${phoneDigits} failed: ${error}`);
      return { ok: false, error };
    }
  }

  /** Free-form reply inside a conversation the customer opened (WhatsApp's 24h window). */
  async reply(conversationId: string, payload: Record<string, unknown>): Promise<SendResult> {
    if (!this.configured) return { ok: false, error: "WhatsApp hub not configured" };
    try {
      await axios.post(`${this.baseUrl}/v1/integrations/conversations/${encodeURIComponent(conversationId)}/messages`, payload, {
        headers: { "X-API-Key": this.apiKey },
        timeout: 15_000,
      });
      return { ok: true };
    } catch (err) {
      const error = describe(err);
      this.logger.warn(`WhatsApp reply in ${conversationId} failed: ${error}`);
      return { ok: false, error };
    }
  }
}
