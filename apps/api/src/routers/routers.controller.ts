import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { AdminRole } from "@netcam/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { RoutersService } from "./routers.service";
import { CreateRouterDto } from "./dto/create-router.dto";
import { UpdateRouterDto } from "./dto/update-router.dto";

@Controller("routers")
export class RoutersController {
  constructor(private readonly service: RoutersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get("topology")
  findTopology() {
    return this.service.findTopology();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Get(":id/active-users")
  findActiveUsers(@Param("id") id: string) {
    return this.service.findActiveUsers(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post()
  create(@Body() dto: CreateRouterDto) {
    return this.service.create(dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateRouterDto) {
    return this.service.update(id, dto);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
