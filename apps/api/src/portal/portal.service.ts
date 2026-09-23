import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { VoucherStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CustomersService } from "../customers/customers.service";
import { VouchersService } from "../vouchers/vouchers.service";
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
    private readonly sms: SmsService,
  ) {}

  async redeem(dto: PortalRedeemDto) {
    const router = dto.routerVlanId
      ? await this.prisma.router.findUnique({ where: { vlanId: dto.routerVlanId } })
      : null;
    return this.vouchers.redeem(
      {
        voucherCode: dto.voucherCode,
        macAddress: dto.macAddress,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      },
      router?.id,
    );
  }

  async status(macAddress: string) {
    const mac = macAddress.toUpperCase();
    const device = await this.prisma.device.findFirst({
      where: { macAddress: mac },
      orderBy: { lastSeenAt: "desc" },
      include: { voucher: { include: { package: true } } },
    });
    if (!device || device.voucher.status !== VoucherStatus.ACTIVE) {
      return { authorized: false };
    }
    return {
      authorized: true,
      voucherCode: device.voucher.code,
      expiresAt: device.voucher.expiresAt?.toISOString(),
      remainingDataMb: device.voucher.package.dataCapMb
        ? Math.max(0, device.voucher.package.dataCapMb - device.voucher.dataUsedMb)
        : undefined,
    };
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
