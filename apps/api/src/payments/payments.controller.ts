import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { PaymentsService } from "./payments.service";
import { InitiatePaymentDto } from "./dto/initiate-payment.dto";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":paymentId/status")
  @Public()
  getStatus(@Param("paymentId") paymentId: string) {
    return this.service.getStatus(paymentId);
  }

  @Public()
  @Post("initiate")
  initiate(@Body() dto: InitiatePaymentDto) {
    return this.service.initiate(dto.packageId, dto.phoneNumber);
  }

  /**
   * Ssentezo success/failure callback. Per their docs this endpoint "should
   * not require authentication", so we never trust the payload's claimed
   * status directly — we only use it to know WHICH transaction to
   * re-verify via an authenticated getStatus() call.
   */
  @Public()
  @Post("webhook/ssentezo")
  async webhook(@Body() body: { data?: { externalReference?: string } }) {
    const externalReference = body?.data?.externalReference;
    if (externalReference) {
      await this.service.handleWebhook(externalReference);
    }
    return { ok: true };
  }
}
