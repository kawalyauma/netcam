import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { AdminRole } from "@netcam/shared";

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsEnum(AdminRole)
  role!: AdminRole;
}
