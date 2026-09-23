import { IsString } from "class-validator";

export class InitiatePaymentDto {
  @IsString()
  packageId!: string;

  @IsString()
  phoneNumber!: string;
}
