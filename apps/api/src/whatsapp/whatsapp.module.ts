import { Module } from "@nestjs/common";
import { CustomersModule } from "../customers/customers.module";
import { WhatsAppBotService } from "./whatsapp-bot.service";
import { WhatsAppClaudeService } from "./whatsapp-claude.service";
import { WhatsAppController } from "./whatsapp.controller";

@Module({
  imports: [CustomersModule],
  providers: [WhatsAppBotService, WhatsAppClaudeService],
  controllers: [WhatsAppController],
})
export class WhatsAppModule {}
