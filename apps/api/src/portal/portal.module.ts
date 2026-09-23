import { Module } from "@nestjs/common";
import { PortalService } from "./portal.service";
import { PortalController } from "./portal.controller";
import { CustomersModule } from "../customers/customers.module";
import { VouchersModule } from "../vouchers/vouchers.module";
import { SmsModule } from "../sms/sms.module";
import { PaymentsModule } from "../payments/payments.module";

@Module({
  imports: [CustomersModule, VouchersModule, SmsModule, PaymentsModule],
  providers: [PortalService],
  controllers: [PortalController],
})
export class PortalModule {}
