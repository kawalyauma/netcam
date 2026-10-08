import { Controller, Headers, HttpCode, Logger, Post, Req, UnauthorizedException, type RawBodyRequest } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";
import { Public } from "../auth/decorators/public.decorator";
import { WhatsAppBotService, type HubEvent } from "./whatsapp-bot.service";

/** Events the WhatsApp Support Hub sends for the NetCam WiFi application. */
@Controller("whatsapp")
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly secret = process.env.WHATSAPP_HUB_WEBHOOK_SECRET ?? "";

  constructor(private readonly bot: WhatsAppBotService) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers("x-support-signature") signature?: string) {
    // The hub signs the raw body with this app's webhook secret; without a
    // configured secret nothing is accepted, since the URL is public.
    if (!this.secret || !req.rawBody || !this.validSignature(req.rawBody, signature)) {
      throw new UnauthorizedException();
    }
    const event = JSON.parse(req.rawBody.toString("utf8")) as HubEvent;
    await this.bot.handle(event).catch((err) => this.logger.error(`WhatsApp event ${event.event} failed: ${(err as Error).message}`));
    return { ok: true };
  }

  private validSignature(raw: Buffer, header?: string): boolean {
    const given = (header ?? "").replace(/^sha256=/, "");
    const expected = createHmac("sha256", this.secret).update(raw).digest("hex");
    return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }
}
