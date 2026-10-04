import { Module } from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { EarningsService } from "./earnings.service";
import { SsentezoGateway } from "./ssentezo.gateway";
import { PAYMENT_GATEWAY } from "./payment-gateway.interface";
import { CustomersModule } from "../customers/customers.module";
import { VouchersModule } from "../vouchers/vouchers.module";
import { SmsModule } from "../sms/sms.module";

@Module({
  imports: [CustomersModule, VouchersModule, SmsModule],
  providers: [PaymentsService, EarningsService, SsentezoGateway, { provide: PAYMENT_GATEWAY, useExisting: SsentezoGateway }],
  controllers: [PaymentsController],
  exports: [PaymentsService, EarningsService],
})
export class PaymentsModule {}
