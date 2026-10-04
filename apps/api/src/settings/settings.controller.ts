import { Body, Controller, ForbiddenException, Get, Param, Put } from "@nestjs/common";
import { AdminRole } from "@netcam/shared";
import { Public } from "../auth/decorators/public.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { SettingsService } from "./settings.service";

@Controller("settings")
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Public()
  @Get()
  getAll() {
    return this.service.getAll();
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Put(":key")
  set(@Param("key") key: string, @Body("value") value: string) {
    if (key.startsWith("finance.")) throw new ForbiddenException("Finance settings are changed from the Withdrawals page");
    return this.service.set(key, value);
  }
}
