import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { PortalService } from "./portal.service";
import { PaymentsService } from "../payments/payments.service";
import { PortalDeviceDto, PortalPayDto, PortalRecoverConfirmDto, PortalRecoverDto, PortalRedeemDto } from "./dto/portal.dto";

/**
 * Public-facing endpoints consumed by apps/portal through the network-agent's
 * portal proxy. Anything that acts on a MAC address requires the agent's
 * shared secret: /api is also reachable from the internet via the admin
 * domain, and MACs on an open WiFi are visible to anyone nearby.
 */
@Controller("portal")
@Public()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly payments: PaymentsService,
  ) {}

  @Post("pay")
  pay(@Body() dto: PortalPayDto, @Headers("x-netcam-secret") secret?: string) {
    const fromAgent = this.isAgent(secret);
    const device = fromAgent && dto.macAddress
      ? { macAddress: dto.macAddress, ipAddress: dto.ipAddress, routerId: dto.routerId }
      : undefined;
    return this.payments.initiate(dto.packageId, dto.phoneNumber, device);
  }

  @Get("pay/:paymentId/status")
  payStatus(@Param("paymentId") paymentId: string) {
    return this.payments.getStatus(paymentId);
  }

  @Post("redeem")
  redeem(@Body() dto: PortalRedeemDto, @Headers("x-netcam-secret") secret?: string) {
    this.assertAgent(secret);
    return this.portal.redeem(dto);
  }

  /** Portal open: logs the device back in if it's entitled, and reports what it has. */
  @Post("status")
  status(@Body() dto: PortalDeviceDto, @Headers("x-netcam-secret") secret?: string) {
    this.assertAgent(secret);
    return this.portal.status(dto);
  }

  /** Launch promo: one-tap free connect from the captive portal. */
  @Post("free-connect")
  freeConnect(@Body() dto: PortalDeviceDto, @Headers("x-netcam-secret") secret?: string) {
    this.assertAgent(secret);
    return this.portal.freeConnect(dto);
  }

  /** Called by the network-agent whenever a device takes a DHCP lease. */
  @Post("auto-login")
  autoLogin(@Body() dto: PortalDeviceDto, @Headers("x-netcam-secret") secret?: string) {
    this.assertAgent(secret);
    return this.portal.autoLogin(dto);
  }

  @Post("recover")
  recover(@Body() dto: PortalRecoverDto) {
    return this.portal.requestRecovery(dto.phoneNumber);
  }

  @Post("recover/confirm")
  confirmRecover(@Body() dto: PortalRecoverConfirmDto) {
    return this.portal.confirmRecovery(dto.phoneNumber, dto.otp);
  }

  private isAgent(secret?: string) {
    return secret === (process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret");
  }

  private assertAgent(secret?: string) {
    if (!this.isAgent(secret)) throw new UnauthorizedException();
  }
}
