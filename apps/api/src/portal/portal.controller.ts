import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { PortalService } from "./portal.service";
import { PaymentsService } from "../payments/payments.service";
import { PortalPayDto, PortalRecoverConfirmDto, PortalRecoverDto, PortalRedeemDto } from "./dto/portal.dto";

/** Public-facing endpoints consumed by apps/portal (the captive portal page). */
@Controller("portal")
@Public()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly payments: PaymentsService,
  ) {}

  @Post("pay")
  pay(@Body() dto: PortalPayDto) {
    return this.payments.initiate(dto.packageId, dto.phoneNumber);
  }

  @Get("pay/:paymentId/status")
  payStatus(@Param("paymentId") paymentId: string) {
    return this.payments.getStatus(paymentId);
  }

  @Post("redeem")
  redeem(@Body() dto: PortalRedeemDto) {
    return this.portal.redeem(dto);
  }

  @Get("status")
  status(@Query("mac") mac: string) {
    return this.portal.status(mac);
  }

  @Post("recover")
  recover(@Body() dto: PortalRecoverDto) {
    return this.portal.requestRecovery(dto.phoneNumber);
  }

  @Post("recover/confirm")
  confirmRecover(@Body() dto: PortalRecoverConfirmDto) {
    return this.portal.confirmRecovery(dto.phoneNumber, dto.otp);
  }
}
