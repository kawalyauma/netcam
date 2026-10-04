import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CustomersModule } from "../customers/customers.module";
import { PaymentsModule } from "../payments/payments.module";
import { SsentezoGateway } from "../payments/ssentezo.gateway";
import { PAYMENT_GATEWAY } from "../payments/payment-gateway.interface";
import { FinanceController } from "./finance.controller";
import { WithdrawalsService } from "./withdrawals.service";
import { LedgerService } from "./ledger.service";

@Module({
  imports: [AuthModule, CustomersModule, PaymentsModule],
  providers: [WithdrawalsService, LedgerService, SsentezoGateway, { provide: PAYMENT_GATEWAY, useExisting: SsentezoGateway }],
  controllers: [FinanceController],
})
export class FinanceModule {}
