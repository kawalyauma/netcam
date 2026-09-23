import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AdminRole, VoucherStatus } from "@netcam/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedAdmin } from "../auth/jwt.strategy";
import { VouchersService } from "./vouchers.service";
import { GenerateVouchersDto } from "./dto/generate-vouchers.dto";

@Controller("vouchers")
export class VouchersController {
  constructor(private readonly service: VouchersService) {}

  @Get()
  findAll(@Query("status") status?: VoucherStatus, @Query("batchLabel") batchLabel?: string) {
    return this.service.findAll({ status, batchLabel });
  }

  @Get(":code")
  findByCode(@Param("code") code: string) {
    return this.service.findByCode(code);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post("generate")
  generate(@Body() dto: GenerateVouchersDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.service.generateBatch(dto, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Patch(":id/suspend")
  suspend(@Param("id") id: string, @Body("reason") reason: string, @CurrentUser() user: AuthenticatedAdmin) {
    return this.service.suspend(id, user.id, reason ?? "manual suspension");
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Patch(":id/devices/:deviceId")
  setDeviceBlocked(
    @Param("id") id: string,
    @Param("deviceId") deviceId: string,
    @Body("isBlocked") isBlocked: boolean,
    @CurrentUser() user: AuthenticatedAdmin,
  ) {
    return this.service.setDeviceBlocked(id, deviceId, Boolean(isBlocked), user.id);
  }
}
