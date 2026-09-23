import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import type { SendSmsResult, SmsProvider } from "./sms-provider.interface";

/**
 * EGO SMS / Pahappa Comms API client.
 * Docs: https://developers.pahappa.com/docs/sending-sms/api-specs-and-usage/
 *
 * Quirk: the API always returns HTTP 200, even on failure — success/failure
 * is only signalled by the `Status` field in the JSON body ("OK" | "Failed").
 */
@Injectable()
export class EgoSmsProvider implements SmsProvider {
  private readonly logger = new Logger(EgoSmsProvider.name);
  private readonly baseUrl = process.env.EGO_SMS_BASE_URL ?? "https://comms.egosms.co/api/v1/json/";
  private readonly username = process.env.EGO_SMS_USERNAME ?? "";
  private readonly password = process.env.EGO_SMS_PASSWORD ?? "";
  private readonly senderId = process.env.EGO_SMS_SENDER_ID ?? "NetCam";

  async send(toPhoneDigits: string, message: string): Promise<SendSmsResult> {
    try {
      const response = await axios.post(
        this.baseUrl,
        {
          method: "SendSms",
          userdata: { username: this.username, password: this.password },
          msgdata: [
            {
              number: toPhoneDigits,
              message,
              senderid: this.senderId,
              priority: 0, // most urgent — this is a time-sensitive voucher/OTP delivery
            },
          ],
        },
        { headers: { "Content-Type": "application/json" }, timeout: 10_000 },
      );

      const body = response.data as { Status?: string; Message?: string; Cost?: number; MsgFollowUpUniqueCode?: string };
      if (body.Status !== "OK") {
        this.logger.warn(`EGO SMS send failed: ${body.Message}`);
        return { ok: false, error: body.Message ?? "Unknown EGO SMS failure" };
      }
      return { ok: true, providerRef: body.MsgFollowUpUniqueCode, cost: body.Cost };
    } catch (err) {
      this.logger.error(`EGO SMS request error: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }
}
