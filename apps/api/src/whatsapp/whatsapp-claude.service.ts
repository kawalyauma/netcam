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

type Engine = "claude" | "codex";

const digitSet = (list: string | undefined) =>
  new Set(
    (list ?? "")
      .split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter(Boolean),
  );

/**
 * Sends WhatsApp messages from the owner's number(s) to Claude Code (or, for
 * WHATSAPP_CODEX_NUMBERS, OpenAI Codex) on the host (scripts/claude-bridge.mjs)
 * instead of the customer menu bot, and replies with the agent's answer.
 * Unconfigured = nobody is routed here.
 */
@Injectable()
export class WhatsAppClaudeService {
  private readonly logger = new Logger(WhatsAppClaudeService.name);
  private readonly numbers = digitSet(process.env.WHATSAPP_CLAUDE_NUMBERS);
  private readonly codexNumbers = digitSet(process.env.WHATSAPP_CODEX_NUMBERS);
  private readonly bridgeUrl = (process.env.CLAUDE_BRIDGE_URL ?? "").replace(/\/+$/, "");
  private readonly secret = process.env.CLAUDE_BRIDGE_SECRET ?? "";

  constructor(private readonly hub: WhatsAppHubService) {}

  private engineFor(phone: string): Engine | null {
    const digits = phone.replace(/\D/g, "");
    if (this.codexNumbers.has(digits)) return "codex";
    return this.numbers.has(digits) ? "claude" : null;
  }

  handles(phone: string): boolean {
    return Boolean(this.bridgeUrl && this.secret) && this.engineFor(phone) !== null;
  }

  /**
   * Runs in the background: Claude can take minutes, the hub webhook can't wait.
   * `choice` is the id of a tapped button or list row. The bridge answers menu
   * commands instantly; "Working on it…" only goes out when Claude is running.
   */
  async handle(phone: string, conversationId: string, text: string | undefined, choice?: string): Promise<void> {
    const engine = this.engineFor(phone) ?? "claude";
    const name = engine === "codex" ? "Codex" : "Claude";
    if (!text?.trim() && !choice) {
      await this.hub.reply(conversationId, { type: "text", message: `Only text messages reach ${name} for now.` });
      return;
    }
    const working = setTimeout(() => {
      void this.hub.reply(conversationId, { type: "text", message: "Working on it…" });
    }, 3000);
    const progress = setInterval(() => {
      void this.hub.reply(conversationId, { type: "text", message: `${name} is still working on this turn…` });
    }, 5 * 60_000);
    let messages: Array<Record<string, unknown>>;
    try {
      const { data } = await axios.post<{ reply: string; messages?: Array<Record<string, unknown>> }>(
        `${this.bridgeUrl}/run`,
        { conversationId, text: text ?? "", choice, engine },
        { headers: { "X-Bridge-Secret": this.secret }, timeout: 65 * 60_000 },
      );
      messages = data.messages?.length ? data.messages : [{ type: "text", message: data.reply }];
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`Claude bridge failed: ${msg}`);
      messages = [{ type: "text", message: `Couldn't reach ${name} on the PC: ${msg}` }];
    } finally {
      clearTimeout(working);
      clearInterval(progress);
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
