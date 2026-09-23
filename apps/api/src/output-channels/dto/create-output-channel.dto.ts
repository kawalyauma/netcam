import { IsEnum, IsOptional, IsString } from "class-validator";
import { OutputChannelType } from "@netcam/shared";

export class CreateOutputChannelDto {
  @IsString()
  name!: string;

  @IsString()
  interfaceName!: string;

  @IsEnum(OutputChannelType)
  type!: OutputChannelType;

  @IsOptional()
  @IsString()
  macAddress?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
