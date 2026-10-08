import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { WhatsAppHubService } from "./whatsapp-hub.service";

// WhatsApp caps a text message at 4096 characters.
const CHUNK = 3900;

function chunks(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > CHUNK) {
    const cut = rest.lastIndexOf("\n", CHUNK);
    const at = cut > CHUNK * 0.5 ? cut : CHUNK;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Sends WhatsApp messages from the owner's number(s) to Claude Code on the
 * host (scripts/claude-bridge.mjs) instead of the customer menu bot, and
 * replies with Claude's answer. Unconfigured = nobody is routed here.
 */
@Injectable()
export class WhatsAppClaudeService {
  private readonly logger = new Logger(WhatsAppClaudeService.name);
  private readonly numbers = new Set(
    (process.env.WHATSAPP_CLAUDE_NUMBERS ?? "")
      .split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter(Boolean),
  );
  private readonly bridgeUrl = (process.env.CLAUDE_BRIDGE_URL ?? "").replace(/\/+$/, "");
  private readonly secret = process.env.CLAUDE_BRIDGE_SECRET ?? "";

  constructor(private readonly hub: WhatsAppHubService) {}

  handles(phoneDigits: string): boolean {
    return Boolean(this.bridgeUrl && this.secret) && this.numbers.has(phoneDigits.replace(/\D/g, ""));
  }

  /**
   * Runs in the background: Claude can take minutes, the hub webhook can't wait.
   * `choice` is the id of a tapped button or list row. The bridge answers menu
   * commands instantly; "Working on it…" only goes out when Claude is running.
   */
  async handle(conversationId: string, text: string | undefined, choice?: string): Promise<void> {
    if (!text?.trim() && !choice) {
      await this.hub.reply(conversationId, { type: "text", message: "Only text messages reach Claude for now." });
      return;
    }
    const working = setTimeout(() => {
      void this.hub.reply(conversationId, { type: "text", message: "Working on it…" });
    }, 3000);
    let messages: Array<Record<string, unknown>>;
    try {
      const { data } = await axios.post<{ reply: string; messages?: Array<Record<string, unknown>> }>(
        `${this.bridgeUrl}/run`,
        { conversationId, text: text ?? "", choice },
        { headers: { "X-Bridge-Secret": this.secret }, timeout: 25 * 60_000 },
      );
      messages = data.messages?.length ? data.messages : [{ type: "text", message: data.reply }];
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`Claude bridge failed: ${msg}`);
      messages = [{ type: "text", message: `Couldn't reach Claude on the PC: ${msg}` }];
    } finally {
      clearTimeout(working);
    }
    for (const m of messages) {
      if (m.type !== "text") {
        const sent = await this.hub.reply(conversationId, m);
        if (sent.ok) continue;
        // A menu the hub rejected still shouldn't leave the owner with nothing.
        await this.hub.reply(conversationId, { type: "text", message: `${String(m.body ?? "")}\n\n(menu failed: ${sent.error})` });
        continue;
      }
      for (const part of chunks(String(m.message ?? ""))) {
        await this.hub.reply(conversationId, { type: "text", message: part });
      }
    }
  }
}
