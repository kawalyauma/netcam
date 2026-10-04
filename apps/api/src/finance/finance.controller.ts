import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { WithdrawalStatus } from "@prisma/client";
import { AdminRole } from "@netcam/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedAdmin } from "../auth/jwt.strategy";
import { WithdrawalsService } from "./withdrawals.service";
import { LedgerService } from "./ledger.service";
import {
  ApproveWithdrawalDto,
  FeeScheduleDto,
  LedgerEntryDto,
  RejectWithdrawalDto,
  RequestWithdrawalDto,
  ResolveWithdrawalDto,
} from "./dto";

/**
 * Operators request withdrawals and keep the books; only a super admin can
 * approve payouts, settle stuck ones, change fees or see the raw wallet.
 */
@Controller("finance")
export class FinanceController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly ledger: LedgerService,
  ) {}

  // ---- withdrawals

  @Get("withdrawals/balance")
  balance() {
    return this.withdrawals.balance();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Get("withdrawals/wallet")
  wallet() {
    return this.withdrawals.walletBalance();
  }

  @Get("withdrawals/fees")
  fees() {
    return this.withdrawals.fees();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Put("withdrawals/fees")
  setFees(@Body() dto: FeeScheduleDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.withdrawals.setFeeSchedule(dto, user);
  }

  @Get("withdrawals/quote")
  quote(@Query("amount") amount: string) {
    return this.withdrawals.quote(Number(amount));
  }

  @Get("withdrawals")
  list(@Query("status") status?: WithdrawalStatus) {
    return this.withdrawals.list(status && status in WithdrawalStatus ? status : undefined);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post("withdrawals")
  request(@Body() dto: RequestWithdrawalDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.withdrawals.request(dto, user);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post("withdrawals/:id/approve")
  approve(@Param("id") id: string, @Body() dto: ApproveWithdrawalDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.withdrawals.approve(id, user, dto.password);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post("withdrawals/:id/reject")
  reject(@Param("id") id: string, @Body() dto: RejectWithdrawalDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.withdrawals.reject(id, user, dto.reason ?? "");
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post("withdrawals/:id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthenticatedAdmin) {
    return this.withdrawals.cancel(id, user);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post("withdrawals/:id/refresh")
  refresh(@Param("id") id: string) {
    return this.withdrawals.refresh(id);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post("withdrawals/:id/resolve")
  resolve(@Param("id") id: string, @Body() dto: ResolveWithdrawalDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.withdrawals.resolve(id, dto.outcome, dto.note, user, dto.password);
  }

  // ---- income & expenses

  @Get("ledger/categories")
  categories() {
    return this.ledger.categories();
  }

  @Get("ledger/summary")
  summary(@Query("from") from: string, @Query("to") to: string) {
    return this.ledger.summary(from, to);
  }

  @Get("ledger")
  entries(@Query("from") from: string, @Query("to") to: string) {
    return this.ledger.list(from, to);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post("ledger")
  createEntry(@Body() dto: LedgerEntryDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.ledger.create(dto, user);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Patch("ledger/:id")
  updateEntry(@Param("id") id: string, @Body() dto: LedgerEntryDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.ledger.update(id, dto, user);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Delete("ledger/:id")
  removeEntry(@Param("id") id: string, @CurrentUser() user: AuthenticatedAdmin) {
    return this.ledger.remove(id, user);
  }
}
