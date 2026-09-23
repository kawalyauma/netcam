import { Controller, Get } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get("overview")
  overview() {
    return this.service.overview();
  }

  @Get("users-per-router")
  usersPerRouter() {
    return this.service.usersPerRouter();
  }
}
