import { IsInt, IsOptional, IsString, Matches } from "class-validator";

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export class PortalPayDto {
  @IsString()
  packageId!: string;

  @IsString()
  phoneNumber!: string;
}

export class PortalRedeemDto {
  @IsString()
  voucherCode!: string;

  @Matches(MAC_REGEX)
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

export class PortalRecoverDto {
  @IsString()
  phoneNumber!: string;
}

export class PortalRecoverConfirmDto {
  @IsString()
  phoneNumber!: string;

  @IsString()
  otp!: string;
}
