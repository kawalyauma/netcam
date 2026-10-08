import { Injectable } from "@nestjs/common";
import { SmsService } from "../sms/sms.service";
import { WhatsAppHubService } from "./whatsapp-hub.service";

export interface OutgoingMessage {
  phoneDigits: string; // 2567XXXXXXXX
  name?: string | null;
  subject: string;
  message: string;
  customerId?: string;
  paymentId?: string;
  /** false = SMS only (e.g. the recipient opted out of WhatsApp). */
  whatsapp?: boolean;
  /** false = never fall back to SMS (it costs money per message). */
  sms?: boolean;
}

export interface Delivery {
  ok: boolean;
  channel: "whatsapp" | "sms" | "none";
  error?: string;
}

/** WhatsApp first (free, reliable), SMS when WhatsApp isn't configured or the send fails. */
@Injectable()
export class MessengerService {
  constructor(
    private readonly whatsapp: WhatsAppHubService,
    private readonly sms: SmsService,
  ) {}

  async send(m: OutgoingMessage): Promise<Delivery> {
    const errors: string[] = [];
    if (m.whatsapp !== false) {
      const wa = await this.whatsapp.sendUpdate(m.phoneDigits, { name: m.name, subject: m.subject, message: m.message });
      if (wa.ok) return { ok: true, channel: "whatsapp" };
      errors.push(`whatsapp: ${wa.error}`);
    }
    if (m.sms !== false) {
      const sms = await this.sms.sendNow({
        toPhoneDigits: m.phoneDigits,
        message: `${this.whatsapp.appName}: ${m.subject}. ${m.message}`,
        customerId: m.customerId,
        paymentId: m.paymentId,
      });
      if (sms.ok) return { ok: true, channel: "sms" };
      errors.push(`sms: ${sms.error}`);
    }
    return { ok: false, channel: "none", error: errors.join("; ") || "no channel enabled" };
  }
}
