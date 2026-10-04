import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { VoucherStatus, type PortalStatusResponse } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CustomersService } from "../customers/customers.service";
import { VouchersService, type DeviceContext } from "../vouchers/vouchers.service";
import { PaymentsService } from "../payments/payments.service";
import { SmsService } from "../sms/sms.service";
import type { PortalRedeemDto } from "./dto/portal.dto";

interface OtpChallenge {
  otp: string;
  expiresAt: number;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class PortalService {
  // In-memory is fine here: OTPs are short-lived (5 min) and this app runs
  // as a single process on one box; worst case on a restart is the customer
  // requests a new code.
  private readonly challenges = new Map<string, OtpChallenge>();
  private readonly lastSentAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly vouchers: VouchersService,
    private readonly payments: PaymentsService,
    private readonly sms: SmsService,
  ) {}

  async redeem(dto: PortalRedeemDto) {
    // routerId comes from the host-side portal proxy, not from the browser,
    // and works for both tagged VLANs and ordinary untagged LAN segments.
    // Keep vlanId as a fallback for older network-agent deployments.
    const router = dto.routerId
      ? await this.prisma.router.findUnique({ where: { id: dto.routerId } })
      : dto.routerVlanId
        ? await this.prisma.router.findUnique({ where: { vlanId: dto.routerVlanId } })
        : null;
    return this.vouchers.redeem(
      {
        voucherCode: dto.voucherCode,
        macAddress: dto.macAddress,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        hostname: dto.hostname,
      },
      router?.id,
    );
  }

  /**
   * Runs every time the portal opens. Showing "Connected" from the database
   * alone isn't enough — after a reboot the firewall has forgotten everyone
   * — so this re-admits the device whenever it's entitled.
   */
  async status(device: DeviceContext): Promise<PortalStatusResponse> {
    const result = await this.vouchers.autoLogin(device);
    if (result.authorized) return result;
    const pending = await this.payments.findPendingForDevice(device.macAddress);
    return { authorized: false, pendingPaymentId: pending?.id };
  }

  autoLogin(device: DeviceContext) {
    return this.vouchers.autoLogin(device);
  }

  /** "I lost my voucher" — step 1: send an OTP to the phone that purchased it. */
  async requestRecovery(rawPhone: string) {
    const customer = await this.customers.findByPhone(rawPhone).catch(() => null);
    // Always respond the same way whether or not the phone is known, so the
    // portal can't be used to enumerate registered numbers.
    if (!customer) return { ok: true };

    const activeVoucher = await this.prisma.voucher.findFirst({
      where: { customerId: customer.id, status: { in: [VoucherStatus.ACTIVE, VoucherStatus.UNUSED] } },
      orderBy: { createdAt: "desc" },
    });
    if (!activeVoucher) return { ok: true };

    const key = customer.phoneNumber;
    const lastSent = this.lastSentAt.get(key) ?? 0;
    if (Date.now() - lastSent < OTP_RESEND_COOLDOWN_MS) {
      return { ok: true }; // silently ignore rapid re-requests
    }

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    this.challenges.set(key, { otp, expiresAt: Date.now() + OTP_TTL_MS });
    this.lastSentAt.set(key, Date.now());

    await this.sms.sendNow({
      toPhoneDigits: key.replace("+", ""),
      message: `NetCam WiFi: your recovery code is ${otp}. It expires in 5 minutes.`,
      customerId: customer.id,
    });

    return { ok: true };
  }

  /** "I lost my voucher" — step 2: verify OTP, return the voucher code. */
  async confirmRecovery(rawPhone: string, otp: string) {
    const customer = await this.customers.findByPhone(rawPhone).catch(() => null);
    if (!customer) throw new NotFoundException("No matching customer");

    const key = customer.phoneNumber;
    const challenge = this.challenges.get(key);
    if (!challenge || challenge.expiresAt < Date.now() || challenge.otp !== otp) {
      throw new BadRequestException("Invalid or expired code");
    }
    this.challenges.delete(key);

    const voucher = await this.prisma.voucher.findFirst({
      where: { customerId: customer.id, status: { in: [VoucherStatus.ACTIVE, VoucherStatus.UNUSED] } },
      orderBy: { createdAt: "desc" },
      include: { package: true },
    });
    if (!voucher) throw new NotFoundException("No active voucher found for this number");

    return { voucherCode: voucher.code, packageName: voucher.package.name, expiresAt: voucher.expiresAt?.toISOString() };
  }
}
