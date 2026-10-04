import { Module } from "@nestjs/common";
import { DashboardService } from "./dashboard.service";
import { DashboardController } from "./dashboard.controller";
import { NetworkModule } from "../network/network.module";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  imports: [NetworkModule, PaymentsModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
