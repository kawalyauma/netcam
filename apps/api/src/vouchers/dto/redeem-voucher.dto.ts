import { IsInt, IsOptional, IsString, Matches } from "class-validator";

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export class RedeemVoucherDto {
  @IsString()
  voucherCode!: string;

  @Matches(MAC_REGEX, { message: "macAddress must be a valid MAC address" })
  macAddress!: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsInt()
  routerVlanId?: number;

  @IsOptional()
  @IsString()
  userAgent?: string;
}
