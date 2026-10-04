import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma, WithdrawalStatus } from "@prisma/client";
import { AdminRole, PaymentProvider, PaymentStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { CustomersService } from "../customers/customers.service";
import { PaymentsService } from "../payments/payments.service";
import { PAYMENT_GATEWAY, type PaymentGateway } from "../payments/payment-gateway.interface";
import type { AuthenticatedAdmin } from "../auth/jwt.strategy";
import { DEFAULT_FEE_SCHEDULE, feeTiers, validateFeeSchedule, withdrawalFee, type FeeSchedule } from "./withdrawal-fees";

const FEE_SCHEDULE_KEY = "finance.withdrawal_fee_schedule";
const CURRENCY = "UGX";
/** Statuses whose amount + fee is taken out of the available balance. */
const HOLDING: WithdrawalStatus[] = [WithdrawalStatus.REQUESTED, WithdrawalStatus.PROCESSING, WithdrawalStatus.SUCCESS];
const POLL_AFTER_MS = 15_000;

export interface RequestWithdrawalInput {
  amountUgx: number;
  phoneNumber: string;
  recipientName?: string;
  note?: string;
  password: string;
}

@Injectable()
export class WithdrawalsService implements OnModuleInit {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly customers: CustomersService,
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  onModuleInit() {
    // Ssentezo posts deposits and withdrawals to the same callback URL.
    this.payments.onWebhook((ref) => this.settle(ref).catch(() => undefined));
  }

  // ---------------------------------------------------------------- fees

  async feeSchedule(): Promise<FeeSchedule> {
    const row = await this.prisma.setting.findUnique({ where: { key: FEE_SCHEDULE_KEY } });
    if (!row) return DEFAULT_FEE_SCHEDULE;
    try {
      const parsed = { ...DEFAULT_FEE_SCHEDULE, ...(JSON.parse(row.value) as Partial<FeeSchedule>) };
      return validateFeeSchedule(parsed) ? DEFAULT_FEE_SCHEDULE : parsed;
    } catch {
      return DEFAULT_FEE_SCHEDULE;
    }
  }

  async setFeeSchedule(schedule: FeeSchedule, admin: AuthenticatedAdmin) {
    const problem = validateFeeSchedule(schedule);
    if (problem) throw new BadRequestException(problem);
    const previous = await this.feeSchedule();
    await this.prisma.setting.upsert({
      where: { key: FEE_SCHEDULE_KEY },
      update: { value: JSON.stringify(schedule) },
      create: { key: FEE_SCHEDULE_KEY, value: JSON.stringify(schedule) },
    });
    await this.audit.log({
      adminUserId: admin.id,
      action: "WITHDRAWAL_FEES_CHANGED",
      entityType: "Setting",
      entityId: FEE_SCHEDULE_KEY,
      metadata: { previous, next: schedule },
    });
    return this.fees();
  }

  async fees() {
    const schedule = await this.feeSchedule();
    return { schedule, tiers: feeTiers(schedule, 12) };
  }

  async quote(amountUgx: number) {
    const schedule = await this.feeSchedule();
    const result = withdrawalFee(amountUgx, schedule);
    if ("error" in result) throw new BadRequestException(result.error);
    const { availableUgx } = await this.balance();
    const totalUgx = amountUgx + result.feeUgx;
    return { amountUgx, feeUgx: result.feeUgx, totalUgx, availableUgx, affordable: totalUgx <= availableUgx };
  }

  // ------------------------------------------------------------- balance

  /**
   * Money in the Ssentezo wallet that belongs to this hotspot: every
   * successful mobile-money sale, minus everything already paid out or on
   * hold (amount + fee). Printed-voucher cash never enters the wallet, so it
   * is not withdrawable here.
   */
  async balance(db: Prisma.TransactionClient = this.prisma) {
    const [earned, byStatus] = await Promise.all([
      db.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS, provider: PaymentProvider.SSENTEZO },
        _sum: { amountUgx: true },
      }),
      db.withdrawal.groupBy({ by: ["status"], _sum: { amountUgx: true, feeUgx: true } }),
    ]);
    const sum = (statuses: WithdrawalStatus[], field: "amountUgx" | "feeUgx" | "both") =>
      byStatus
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => {
          const amount = row._sum.amountUgx ?? 0;
          const fee = row._sum.feeUgx ?? 0;
          return total + (field === "amountUgx" ? amount : field === "feeUgx" ? fee : amount + fee);
        }, 0);

    const earnedUgx = earned._sum.amountUgx ?? 0;
    const onHoldUgx = sum([WithdrawalStatus.REQUESTED, WithdrawalStatus.PROCESSING], "both");
    const withdrawnUgx = sum([WithdrawalStatus.SUCCESS], "amountUgx");
    const feesPaidUgx = sum([WithdrawalStatus.SUCCESS], "feeUgx");
    return {
      earnedUgx,
      onHoldUgx,
      withdrawnUgx,
      feesPaidUgx,
      availableUgx: Math.max(0, earnedUgx - sum(HOLDING, "both")),
    };
  }

  async walletBalance() {
    return this.gateway.getBalance(CURRENCY);
  }

  // -------------------------------------------------------------- list

  list(status?: WithdrawalStatus) {
    return this.prisma.withdrawal.findMany({
      where: status ? { status } : undefined,
      include: {
        requestedBy: { select: { email: true, fullName: true } },
        reviewedBy: { select: { email: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  }

  // ----------------------------------------------------------- request

  async request(input: RequestWithdrawalInput, admin: AuthenticatedAdmin) {
    await this.confirmPassword(admin, input.password);

    const phoneNumber = this.customers.normalizePhone(input.phoneNumber);
    if (!/^\+256\d{9}$/.test(phoneNumber)) {
      throw new BadRequestException("Enter a valid Ugandan mobile-money number, e.g. 0772123456");
    }
    const schedule = await this.feeSchedule();
    const fee = withdrawalFee(input.amountUgx, schedule);
    if ("error" in fee) throw new BadRequestException(fee.error);

    // Serializable so two simultaneous requests can't both spend the same balance.
    const withdrawal = await this.prisma
      .$transaction(
      async (tx) => {
        const { availableUgx } = await this.balance(tx);
        const total = input.amountUgx + fee.feeUgx;
        if (total > availableUgx) {
          throw new BadRequestException(
            `Not enough balance: UGX ${input.amountUgx.toLocaleString()} + fee UGX ${fee.feeUgx.toLocaleString()} = UGX ${total.toLocaleString()}, but only UGX ${availableUgx.toLocaleString()} is available`,
          );
        }
        return tx.withdrawal.create({
          data: {
            amountUgx: input.amountUgx,
            feeUgx: fee.feeUgx,
            phoneNumber,
            recipientName: input.recipientName?.trim() || null,
            note: input.note?.trim() || null,
            requestedById: admin.id,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((err: unknown) => {
        // P2034: lost a serialization race with another request — safe to retry.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
          throw new BadRequestException("Another withdrawal was being made at the same time. Please try again.");
        }
        throw err;
      });

    await this.audit.log({
      adminUserId: admin.id,
      action: "WITHDRAWAL_REQUESTED",
      entityType: "Withdrawal",
      entityId: withdrawal.id,
      metadata: { amountUgx: withdrawal.amountUgx, feeUgx: withdrawal.feeUgx, phoneNumber },
    });

    // A super admin approves their own request by making it.
    if (admin.role === AdminRole.SUPER_ADMIN) {
      return this.send(withdrawal.id, admin);
    }
    return withdrawal;
  }

  // ------------------------------------------------ approve / reject / cancel

  async approve(id: string, admin: AuthenticatedAdmin, password: string) {
    await this.confirmPassword(admin, password);
    return this.send(id, admin);
  }

  async reject(id: string, admin: AuthenticatedAdmin, reason: string) {
    const changed = await this.prisma.withdrawal.updateMany({
      where: { id, status: WithdrawalStatus.REQUESTED },
      data: { status: WithdrawalStatus.REJECTED, reviewedById: admin.id, reviewedAt: new Date(), reviewNote: reason?.trim() || null },
    });
    if (!changed.count) throw new BadRequestException("Only a withdrawal waiting for approval can be rejected");
    await this.audit.log({ adminUserId: admin.id, action: "WITHDRAWAL_REJECTED", entityType: "Withdrawal", entityId: id, metadata: { reason } });
    return this.get(id);
  }

  async cancel(id: string, admin: AuthenticatedAdmin) {
    const existing = await this.get(id);
    if (existing.requestedById !== admin.id && admin.role !== AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException("You can only cancel your own withdrawal requests");
    }
    const changed = await this.prisma.withdrawal.updateMany({
      where: { id, status: WithdrawalStatus.REQUESTED },
      data: { status: WithdrawalStatus.CANCELLED, reviewedAt: new Date() },
    });
    if (!changed.count) throw new BadRequestException("Only a withdrawal waiting for approval can be cancelled");
    await this.audit.log({ adminUserId: admin.id, action: "WITHDRAWAL_CANCELLED", entityType: "Withdrawal", entityId: id });
    return this.get(id);
  }

  /**
   * Manual settlement for a payout Ssentezo can't confirm either way. The
   * super admin checks the Ssentezo dashboard / recipient and records the
   * outcome; FAILED releases the held balance.
   */
  async resolve(id: string, outcome: "SUCCESS" | "FAILED", note: string, admin: AuthenticatedAdmin, password: string) {
    await this.confirmPassword(admin, password);
    if (!note?.trim()) throw new BadRequestException("Say how you confirmed the outcome (e.g. the Ssentezo transaction ID)");
    const changed = await this.prisma.withdrawal.updateMany({
      where: { id, status: WithdrawalStatus.PROCESSING },
      data: {
        status: outcome === "SUCCESS" ? WithdrawalStatus.SUCCESS : WithdrawalStatus.FAILED,
        completedAt: new Date(),
        reviewNote: `Manually marked ${outcome.toLowerCase()}: ${note.trim()}`,
        failureReason: outcome === "FAILED" ? note.trim() : null,
      },
    });
    if (!changed.count) throw new BadRequestException("Only a withdrawal that is still processing can be resolved manually");
    await this.audit.log({ adminUserId: admin.id, action: "WITHDRAWAL_RESOLVED", entityType: "Withdrawal", entityId: id, metadata: { outcome, note } });
    return this.get(id);
  }

  /** Re-checks a PROCESSING withdrawal with Ssentezo right away. */
  async refresh(id: string) {
    await this.settle(id);
    return this.get(id);
  }

  // ------------------------------------------------------------ payout

  /**
   * Moves a REQUESTED withdrawal to PROCESSING (atomically, so a double
   * click or two admins can never pay it twice) and asks Ssentezo to pay out.
   */
  private async send(id: string, admin: AuthenticatedAdmin) {
    const claimed = await this.prisma.withdrawal.updateMany({
      where: { id, status: WithdrawalStatus.REQUESTED },
      data: { status: WithdrawalStatus.PROCESSING, reviewedById: admin.id, reviewedAt: new Date(), sentAt: new Date() },
    });
    if (!claimed.count) throw new BadRequestException("This withdrawal is no longer waiting for approval");

    const withdrawal = await this.get(id);
    const result = await this.gateway.initiateWithdrawal({
      externalReference: withdrawal.id,
      msisdnDigits: withdrawal.phoneNumber.replace("+", ""),
      amount: withdrawal.amountUgx,
      currency: CURRENCY,
      reason: `NetCam withdrawal${withdrawal.note ? `: ${withdrawal.note}` : ""}`.slice(0, 120),
      payerName: withdrawal.recipientName ?? undefined,
    });

    if (result.ok) {
      await this.prisma.withdrawal.update({
        where: { id },
        data: {
          providerRef: result.providerRef,
          financialTransactionId: result.financialTransactionId,
          rawResponse: result as object,
        },
      });
      if (result.transactionStatus === "SUCCEEDED") await this.markSucceeded(id, result.financialTransactionId);
      if (result.transactionStatus === "FAILED") await this.markFailed(id, "Ssentezo rejected the payout");
    } else if (result.uncertain) {
      // Unknown outcome: keep it PROCESSING (balance stays held) and let the
      // poller ask Ssentezo what happened. Never resend.
      await this.prisma.withdrawal.update({
        where: { id },
        data: { failureReason: `Waiting for confirmation: ${result.errorMessage}`, rawResponse: result as object },
      });
    } else {
      await this.markFailed(id, result.errorMessage ?? "Ssentezo declined the payout");
    }

    await this.audit.log({
      adminUserId: admin.id,
      action: "WITHDRAWAL_SENT",
      entityType: "Withdrawal",
      entityId: id,
      metadata: { ok: result.ok, uncertain: result.uncertain ?? false, error: result.errorMessage },
    });
    return this.get(id);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollProcessing() {
    const due = await this.prisma.withdrawal.findMany({
      where: { status: WithdrawalStatus.PROCESSING, sentAt: { lte: new Date(Date.now() - POLL_AFTER_MS) } },
      select: { id: true },
      take: 50,
    });
    for (const w of due) await this.settle(w.id).catch((err) => this.logger.warn(`withdrawal ${w.id}: ${(err as Error).message}`));
  }

  private async settle(id: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!withdrawal || withdrawal.status !== WithdrawalStatus.PROCESSING) return;

    const status = await this.gateway.getStatus(id);
    if (!status.ok) {
      // Ssentezo has no record of it: the initial request never landed, so
      // nothing was paid — release the hold. Otherwise just try again later.
      const neverArrived = /not\s*found|does not exist|no transaction/i.test(status.errorMessage ?? "");
      const ageMs = Date.now() - (withdrawal.sentAt?.getTime() ?? Date.now());
      if (neverArrived && ageMs > 5 * 60_000) await this.markFailed(id, "Ssentezo never received the payout request");
      return;
    }
    if (status.amount !== undefined && status.amount !== withdrawal.amountUgx) {
      this.logger.error(`Withdrawal ${id}: Ssentezo amount ${status.amount} != requested ${withdrawal.amountUgx}`);
    }
    if (status.transactionStatus === "SUCCEEDED") await this.markSucceeded(id, status.financialTransactionId);
    else if (status.transactionStatus === "FAILED") await this.markFailed(id, "The mobile-money network declined the payout");
  }

  private async markSucceeded(id: string, financialTransactionId?: string) {
    await this.prisma.withdrawal.updateMany({
      where: { id, status: WithdrawalStatus.PROCESSING },
      data: { status: WithdrawalStatus.SUCCESS, completedAt: new Date(), failureReason: null, financialTransactionId },
    });
  }

  private async markFailed(id: string, reason: string) {
    await this.prisma.withdrawal.updateMany({
      where: { id, status: WithdrawalStatus.PROCESSING },
      data: { status: WithdrawalStatus.FAILED, completedAt: new Date(), failureReason: reason },
    });
  }

  // ------------------------------------------------------------ helpers

  private async get(id: string) {
    const w = await this.prisma.withdrawal.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { email: true, fullName: true } },
        reviewedBy: { select: { email: true, fullName: true } },
      },
    });
    if (!w) throw new NotFoundException("Withdrawal not found");
    return w;
  }

  /** Moving money needs the admin's password again, not just a live session. */
  private async confirmPassword(admin: AuthenticatedAdmin, password: string) {
    if (!password || !(await this.auth.verifyPassword(admin.id, password))) {
      throw new ForbiddenException("Password is incorrect");
    }
  }
}
