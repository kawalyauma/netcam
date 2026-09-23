import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { AdminRole } from "@netcam/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedAdmin } from "../auth/jwt.strategy";
import { AdminUsersService } from "./admin-users.service";
import { CreateAdminUserDto } from "./dto/create-admin-user.dto";

@Roles(AdminRole.SUPER_ADMIN)
@Controller("admin-users")
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateAdminUserDto, @CurrentUser() user: AuthenticatedAdmin) {
    return this.service.create(dto, user.id);
  }

  @Patch(":id/activate")
  activate(@Param("id") id: string, @CurrentUser() user: AuthenticatedAdmin) {
    return this.service.setActive(id, true, user.id);
  }

  @Patch(":id/deactivate")
  deactivate(@Param("id") id: string, @CurrentUser() user: AuthenticatedAdmin) {
    return this.service.setActive(id, false, user.id);
  }
}
