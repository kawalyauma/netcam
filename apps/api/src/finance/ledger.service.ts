import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { LedgerEntryType, LedgerPaymentMethod, WithdrawalStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EarningsService, dayKey, TIME_ZONE } from "../payments/earnings.service";
import type { AuthenticatedAdmin } from "../auth/jwt.strategy";

export const EXPENSE_CATEGORIES = [
  "Internet / data bundles",
  "Electricity",
  "Rent",
  "Equipment & routers",
  "Repairs & maintenance",
  "Salaries & wages",
  "Transport",
  "Airtime & SMS",
  "Printing vouchers",
  "Other expense",
];
export const INCOME_CATEGORIES = ["Cash sales", "Device charging", "Other income"];

/** Categories the system fills in by itself; they can't be used for manual entries. */
const AUTO = {
  mobileMoney: "Mobile money sales",
  vouchers: "Printed voucher sales",
  manualPayments: "Manual payments",
  withdrawalFees: "Withdrawal fees",
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface LedgerEntryInput {
  type: LedgerEntryType;
  category: string;
  amountUgx: number;
  occurredOn: string; // YYYY-MM-DD
  description?: string;
  paymentMethod?: LedgerPaymentMethod;
}

@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly earnings: EarningsService,
  ) {}

  categories() {
    return { income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES, automatic: Object.values(AUTO) };
  }

  list(from: string, to: string, type?: LedgerEntryType) {
    const range = this.range(from, to);
    return this.prisma.ledgerEntry.findMany({
      where: { deletedAt: null, occurredOn: { gte: range.fromDate, lte: range.toDate }, ...(type ? { type } : {}) },
      include: { createdBy: { select: { email: true, fullName: true } } },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    });
  }

  async create(input: LedgerEntryInput, admin: AuthenticatedAdmin) {
    const data = this.validate(input);
    const entry = await this.prisma.ledgerEntry.create({ data: { ...data, createdById: admin.id } });
    await this.audit.log({ adminUserId: admin.id, action: "LEDGER_ENTRY_CREATED", entityType: "LedgerEntry", entityId: entry.id, metadata: { ...data, occurredOn: input.occurredOn } });
    return entry;
  }

  async update(id: string, input: LedgerEntryInput, admin: AuthenticatedAdmin) {
    const existing = await this.prisma.ledgerEntry.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException("Entry not found");
    const data = this.validate(input);
    const entry = await this.prisma.ledgerEntry.update({ where: { id }, data });
    await this.audit.log({
      adminUserId: admin.id,
      action: "LEDGER_ENTRY_UPDATED",
      entityType: "LedgerEntry",
      entityId: id,
      metadata: { before: { ...existing, occurredOn: existing.occurredOn.toISOString().slice(0, 10) }, after: { ...data, occurredOn: input.occurredOn } },
    });
    return entry;
  }

  /** Soft delete: the row stays for the audit trail but stops counting. */
  async remove(id: string, admin: AuthenticatedAdmin) {
    const changed = await this.prisma.ledgerEntry.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!changed.count) throw new NotFoundException("Entry not found");
    await this.audit.log({ adminUserId: admin.id, action: "LEDGER_ENTRY_DELETED", entityType: "LedgerEntry", entityId: id });
    return { ok: true };
  }

  /**
   * Profit & loss for a date range: automatic income (portal sales), manual
   * income, manual expenses and withdrawal fees — plus a month-by-month view.
   * Withdrawals themselves are not expenses: they move your own money out of
   * the wallet. Only their fee is a cost.
   */
  async summary(from: string, to: string) {
    const range = this.range(from, to);
    const inRange = (key: string) => key >= range.from && key <= range.to;
    const monthOf = (key: string) => key.slice(0, 7);

    const [sales, entries, withdrawals] = await Promise.all([
      this.earnings.sales(new Date(range.fromDate.getTime() - DAY_MS)),
      this.prisma.ledgerEntry.findMany({
        where: { deletedAt: null, occurredOn: { gte: range.fromDate, lte: range.toDate } },
        select: { type: true, category: true, amountUgx: true, occurredOn: true },
      }),
      this.prisma.withdrawal.findMany({
        where: { status: WithdrawalStatus.SUCCESS, completedAt: { gte: new Date(range.fromDate.getTime() - DAY_MS) } },
        select: { feeUgx: true, amountUgx: true, completedAt: true },
      }),
    ]);

    const income = new Map<string, { category: string; amountUgx: number; count: number; automatic: boolean }>();
    const expense = new Map<string, { category: string; amountUgx: number; count: number; automatic: boolean }>();
    const monthly = new Map<string, { month: string; incomeUgx: number; expenseUgx: number }>();
    const add = (
      bucket: typeof income,
      category: string,
      amountUgx: number,
      automatic: boolean,
      key: string,
      side: "incomeUgx" | "expenseUgx",
    ) => {
      const row = bucket.get(category) ?? { category, amountUgx: 0, count: 0, automatic };
      row.amountUgx += amountUgx;
      row.count += 1;
      bucket.set(category, row);
      const m = monthly.get(monthOf(key)) ?? { month: monthOf(key), incomeUgx: 0, expenseUgx: 0 };
      m[side] += amountUgx;
      monthly.set(monthOf(key), m);
    };

    for (const s of sales) {
      const key = dayKey.format(s.at);
      if (!inRange(key)) continue;
      const category = s.source === "VOUCHER" ? AUTO.vouchers : s.source === "MANUAL" ? AUTO.manualPayments : AUTO.mobileMoney;
      add(income, category, s.amountUgx, true, key, "incomeUgx");
    }
    for (const e of entries) {
      const key = e.occurredOn.toISOString().slice(0, 10);
      if (e.type === LedgerEntryType.INCOME) add(income, e.category, e.amountUgx, false, key, "incomeUgx");
      else add(expense, e.category, e.amountUgx, false, key, "expenseUgx");
    }
    let withdrawnUgx = 0;
    for (const w of withdrawals) {
      const key = dayKey.format(w.completedAt as Date);
      if (!inRange(key)) continue;
      withdrawnUgx += w.amountUgx;
      add(expense, AUTO.withdrawalFees, w.feeUgx, true, key, "expenseUgx");
    }

    const incomeUgx = [...income.values()].reduce((sum, r) => sum + r.amountUgx, 0);
    const expenseUgx = [...expense.values()].reduce((sum, r) => sum + r.amountUgx, 0);
    return {
      from: range.from,
      to: range.to,
      timeZone: TIME_ZONE,
      totals: { incomeUgx, expenseUgx, profitUgx: incomeUgx - expenseUgx, withdrawnUgx },
      income: [...income.values()].sort((a, b) => b.amountUgx - a.amountUgx),
      expenses: [...expense.values()].sort((a, b) => b.amountUgx - a.amountUgx),
      monthly: [...monthly.values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((m) => ({ ...m, profitUgx: m.incomeUgx - m.expenseUgx })),
    };
  }

  private validate(input: LedgerEntryInput) {
    if (input.type !== LedgerEntryType.INCOME && input.type !== LedgerEntryType.EXPENSE) {
      throw new BadRequestException("Choose income or expense");
    }
    const category = input.category?.trim();
    if (!category) throw new BadRequestException("Choose a category");
    if ((Object.values(AUTO) as string[]).includes(category)) {
      throw new BadRequestException(`"${category}" is filled in automatically; pick another category`);
    }
    if (!Number.isInteger(input.amountUgx) || input.amountUgx <= 0) throw new BadRequestException("Amount must be a whole number of UGX above 0");
    if (input.amountUgx > 1_000_000_000) throw new BadRequestException("Amount looks too large");
    if (!DATE_RE.test(input.occurredOn ?? "")) throw new BadRequestException("Pick the date it happened");
    const occurredOn = new Date(`${input.occurredOn}T00:00:00Z`);
    if (Number.isNaN(occurredOn.getTime())) throw new BadRequestException("Invalid date");
    if (input.occurredOn > dayKey.format(new Date())) throw new BadRequestException("The date can't be in the future");
    return {
      type: input.type,
      category,
      amountUgx: input.amountUgx,
      occurredOn,
      description: input.description?.trim() || null,
      paymentMethod: input.paymentMethod ?? LedgerPaymentMethod.CASH,
    };
  }

  private range(from: string, to: string) {
    const today = dayKey.format(new Date());
    const f = DATE_RE.test(from ?? "") ? from : `${today.slice(0, 7)}-01`;
    const t = DATE_RE.test(to ?? "") ? to : today;
    if (f > t) throw new BadRequestException("The start date must be before the end date");
    return { from: f, to: t, fromDate: new Date(`${f}T00:00:00Z`), toDate: new Date(`${t}T00:00:00Z`) };
  }
}
