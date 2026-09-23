import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsNumber, IsOptional, IsString, Matches, ValidateNested } from "class-validator";

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

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
