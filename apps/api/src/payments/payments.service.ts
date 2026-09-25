import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PaymentStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CustomersService } from "../customers/customers.service";
import { VouchersService } from "../vouchers/vouchers.service";
import { SmsService } from "../sms/sms.service";
import { PAYMENT_GATEWAY, type PaymentGateway } from "./payment-gateway.interface";

const CURRENCY = "UGX";
const MIN_SSENTEZO_AMOUNT_UGX = 500;
const MAX_SSENTEZO_AMOUNT_UGX = 7_000_000;
const POLL_STALE_AFTER_MS = 15_000; // don't poll a transaction until it's had a moment to leave PENDING

class PaymentAlreadyReconciledError extends Error {}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly vouchers: VouchersService,
    private readonly sms: SmsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async initiate(packageId: string, rawPhone: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw new BadRequestException("Package not available");
    if (!Number.isInteger(pkg.priceUgx) || pkg.priceUgx < MIN_SSENTEZO_AMOUNT_UGX || pkg.priceUgx > MAX_SSENTEZO_AMOUNT_UGX) {
      throw new BadRequestException("Package price must be between UGX 500 and UGX 7,000,000 for mobile money");
    }

    const customer = await this.customers.findOrCreateByPhone(rawPhone);
    const msisdnDigits = customer.phoneNumber.replace("+", "");
    if (!/^256\d{9}$/.test(msisdnDigits)) {
      throw new BadRequestException("Enter a valid Ugandan mobile-money phone number");
    }

    const payment = await this.prisma.payment.create({
      data: {
        customerId: customer.id,
        packageId: pkg.id,
        amountUgx: pkg.priceUgx,
        status: PaymentStatus.PENDING,
      },
    });

    const result = await this.gateway.initiateDeposit({
      externalReference: payment.id,
      msisdnDigits,
      amount: pkg.priceUgx,
      currency: CURRENCY,
      reason: `NetCam WiFi: ${pkg.name}`,
      payerName: customer.name ?? undefined,
    });

    if (!result.ok) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: result.errorMessage, rawRequest: result as object },
      });
      throw new BadRequestException(result.errorMessage ?? "Payment could not be started. Check your phone number and try again.");
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: result.providerRef, rawRequest: result as object },
    });

    return {
      paymentId: payment.id,
      status: "PENDING",
      message: "Check your phone and enter your Mobile Money PIN to complete payment.",
    };
  }

  async getStatus(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { voucher: true } });
    if (!payment) throw new NotFoundException("Payment not found");
    return {
      status: payment.status,
      voucherCode: payment.voucher?.code,
    };
  }

  /** Independently re-verifies with Ssentezo rather than trusting the webhook body — the callback endpoint has no signature/auth per their docs. */
  async handleWebhook(externalReference: string) {
    await this.reconcile(externalReference);
  }

  /** Polls every PENDING payment that hasn't resolved yet — the reliable default since vendor boxes usually have no public IP for callbacks. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollPending() {
    const cutoff = new Date(Date.now() - POLL_STALE_AFTER_MS);
    const pending = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.PENDING, createdAt: { lte: cutoff } },
      take: 50,
    });
    for (const payment of pending) {
      await this.reconcile(payment.id);
    }
  }

  private async reconcile(externalReference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: externalReference },
      include: { customer: true, package: true },
    });
    if (!payment || payment.status !== PaymentStatus.PENDING) return;

    const status = await this.gateway.getStatus(externalReference);
    if (!status.ok || !status.transactionStatus) {
      this.logger.warn(`Ssentezo status check failed for ${externalReference}: ${status.errorMessage}`);
      return;
    }

    if (status.externalReference && status.externalReference !== payment.id) {
      this.logger.error(`Ssentezo reference mismatch for payment ${payment.id}`);
      return;
    }

    if (status.amount !== undefined && status.amount !== payment.amountUgx) {
      this.logger.error(`Ssentezo amount mismatch for payment ${payment.id}: expected ${payment.amountUgx}, got ${status.amount}`);
      return;
    }

    if (status.currency && status.currency !== CURRENCY) {
      this.logger.error(`Ssentezo currency mismatch for payment ${payment.id}: expected ${CURRENCY}, got ${status.currency}`);
      return;
    }

    if (status.transactionStatus === "PENDING" || status.transactionStatus === "INDETERMINATE") {
      return; // still waiting; will be re-checked next poll
    }

    if (status.transactionStatus === "FAILED") {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED, rawWebhook: status as object },
      });
      return;
    }

    // SUCCEEDED
    let voucher: Awaited<ReturnType<VouchersService["issueForPayment"]>>;
    try {
      voucher = await this.prisma.$transaction(async (tx) => {
        const issued = await this.vouchers.issueForPayment(payment.packageId, payment.customerId, tx);
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: PaymentStatus.PENDING },
          data: {
            status: PaymentStatus.SUCCESS,
            completedAt: new Date(),
            voucherId: issued.id,
            providerRef: status.providerRef ?? payment.providerRef,
            rawWebhook: status as object,
          },
        });
        if (claimed.count !== 1) throw new PaymentAlreadyReconciledError();
        return issued;
      });
    } catch (error) {
      if (error instanceof PaymentAlreadyReconciledError) return;
      throw error;
    }

    const message = `NetCam WiFi: Payment received! Your voucher code is ${voucher.code}. Use it on the WiFi login page. Data/duration: ${payment.package.name}.`;
    await this.sms.sendNow({
      toPhoneDigits: payment.customer.phoneNumber.replace("+", ""),
      message,
      customerId: payment.customerId,
      paymentId: payment.id,
    });
  }

  findAll() {
    return this.prisma.payment.findMany({
      include: { customer: true, package: true, voucher: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }
}
