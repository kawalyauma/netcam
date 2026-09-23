import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { AdminRole } from "@netcam/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedAdmin } from "../auth/jwt.strategy";
import { OutputChannelsService } from "./output-channels.service";
import { CreateOutputChannelDto } from "./dto/create-output-channel.dto";

@Controller("output-channels")
export class OutputChannelsController {
  constructor(private readonly service: OutputChannelsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post()
  create(@Body() dto: CreateOutputChannelDto) {
    return this.service.create(dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Patch(":id/activate")
  setActive(@Param("id") id: string, @CurrentUser() user: AuthenticatedAdmin) {
    return this.service.setActive(id, user.id);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
