import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";
import { LedgerEntryType, LedgerPaymentMethod } from "@prisma/client";

export class RequestWithdrawalDto {
  @IsInt()
  @Min(1)
  amountUgx!: number;

  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class ApproveWithdrawalDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RejectWithdrawalDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class ResolveWithdrawalDto {
  @IsIn(["SUCCESS", "FAILED"])
  outcome!: "SUCCESS" | "FAILED";

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  note!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class FeeScheduleDto {
  @IsInt()
  @Min(0)
  minAmountUgx!: number;

  @IsInt()
  @Min(0)
  maxAmountUgx!: number;

  @IsInt()
  @Min(1)
  bandSizeUgx!: number;

  @IsInt()
  @Min(0)
  baseFeeUgx!: number;

  @IsInt()
  @Min(0)
  stepFeeUgx!: number;
}

export class LedgerEntryDto {
  @IsEnum(LedgerEntryType)
  type!: LedgerEntryType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category!: string;

  @IsInt()
  @Min(1)
  amountUgx!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "occurredOn must be a date like 2026-09-28" })
  occurredOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsEnum(LedgerPaymentMethod)
  paymentMethod?: LedgerPaymentMethod;
}
