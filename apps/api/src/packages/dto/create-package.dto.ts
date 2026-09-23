import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { PackageLimitType } from "@netcam/shared";

export class CreatePackageDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  priceUgx!: number;

  @IsEnum(PackageLimitType)
  limitType!: PackageLimitType;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dataCapMb?: number;

  @IsInt()
  @Min(1)
  downKbps!: number;

  @IsInt()
  @Min(1)
  upKbps!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  deviceLimit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
