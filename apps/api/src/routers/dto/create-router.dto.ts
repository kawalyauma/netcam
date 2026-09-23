import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateRouterDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  macAddress?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  vlanId?: number;

  @IsOptional()
  @IsString()
  subnetCidr?: string;

  @IsOptional()
  @IsString()
  apSsid?: string;

  @IsOptional()
  @IsString()
  apPassword?: string;

  @IsOptional()
  @IsString()
  outputChannelId?: string;

  @IsOptional()
  @IsString()
  parentRouterId?: string;
}
