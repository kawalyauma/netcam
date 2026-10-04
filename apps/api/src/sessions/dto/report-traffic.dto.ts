import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateNested } from "class-validator";

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export class AppUsageDto {
  @IsString()
  @MaxLength(64)
  app!: string;

  @IsNumber()
  bytesUp!: number;

  @IsNumber()
  bytesDown!: number;
}

export class TrafficSampleDto {
  @Matches(MAC_REGEX)
  macAddress!: string;

  @IsNumber()
  bytesUp!: number;

  @IsNumber()
  bytesDown!: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  observedTtls?: number[];

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  hostname?: string;

  /** Per-app split of this sample's bytes, from the agent's usage collector. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppUsageDto)
  apps?: AppUsageDto[];
}

export class ReportTrafficDto {
  @IsString()
  routerId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TrafficSampleDto)
  samples!: TrafficSampleDto[];
}
