import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AdminRole } from "@netcam/shared";
import { Roles } from "../auth/decorators/roles.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { PackagesService } from "./packages.service";
import { CreatePackageDto } from "./dto/create-package.dto";
import { UpdatePackageDto } from "./dto/update-package.dto";

@Controller("packages")
export class PackagesController {
  constructor(private readonly service: PackagesService) {}

  @Public()
  @Get()
  findAll(@Query("activeOnly") activeOnly?: string) {
    return this.service.findAll(activeOnly === "true");
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post()
  create(@Body() dto: CreatePackageDto) {
    return this.service.create(dto);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdatePackageDto) {
    return this.service.update(id, dto);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
