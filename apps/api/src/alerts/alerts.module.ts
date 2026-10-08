import { Global, Module } from "@nestjs/common";
import { SmsModule } from "../sms/sms.module";
import { NetworkAgentBridgeModule } from "../network-agent-bridge/network-agent-bridge.module";
import { WhatsAppHubService } from "../whatsapp/whatsapp-hub.service";
import { MessengerService } from "../whatsapp/messenger.service";
import { AlertsService } from "./alerts.service";
import { AlertsMonitorService } from "./alerts-monitor.service";
import { AlertsController } from "./alerts.controller";

/** Global so any module can raise alerts or message a customer without new imports. */
@Global()
@Module({
  imports: [SmsModule, NetworkAgentBridgeModule],
  providers: [WhatsAppHubService, MessengerService, AlertsService, AlertsMonitorService],
  controllers: [AlertsController],
  exports: [WhatsAppHubService, MessengerService, AlertsService],
})
export class AlertsModule {}
