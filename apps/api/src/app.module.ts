import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { OutputChannelsModule } from "./output-channels/output-channels.module";
import { RoutersModule } from "./routers/routers.module";
import { PackagesModule } from "./packages/packages.module";
import { VouchersModule } from "./vouchers/vouchers.module";
import { CustomersModule } from "./customers/customers.module";
import { SessionsModule } from "./sessions/sessions.module";
import { SmsModule } from "./sms/sms.module";
import { PaymentsModule } from "./payments/payments.module";
import { PortalModule } from "./portal/portal.module";
import { NetworkAgentBridgeModule } from "./network-agent-bridge/network-agent-bridge.module";
import { SettingsModule } from "./settings/settings.module";
import { DashboardModule } from "./dashboard/dashboard.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    OutputChannelsModule,
    RoutersModule,
    PackagesModule,
    VouchersModule,
    CustomersModule,
    SessionsModule,
    SmsModule,
    PaymentsModule,
    PortalModule,
    NetworkAgentBridgeModule,
    SettingsModule,
    DashboardModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
