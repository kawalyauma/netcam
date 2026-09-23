import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class GenerateVouchersDto {
  @IsString()
  packageId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  count!: number;

  @IsOptional()
  @IsString()
  batchLabel?: string;

  @IsOptional()
  @IsString()
  generatedAtRouterId?: string;
}
