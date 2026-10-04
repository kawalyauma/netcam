import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export class PortalPayDto {
  @IsString()
  packageId!: string;

  @IsString()
  phoneNumber!: string;

  // Filled in by the network-agent's portal proxy from ARP, never by the browser.
  @IsOptional()
  @Matches(MAC_REGEX)
  macAddress?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsUUID()
  routerId?: string;
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
  @IsUUID()
  routerId?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  hostname?: string;
}

export class PortalDeviceDto {
  @Matches(MAC_REGEX)
  macAddress!: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsUUID()
  routerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  hostname?: string;
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
