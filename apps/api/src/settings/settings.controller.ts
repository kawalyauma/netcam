import { Body, Controller, Get, Param, Put } from "@nestjs/common";
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
    return this.service.set(key, value);
  }
}
