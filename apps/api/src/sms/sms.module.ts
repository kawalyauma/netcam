import { Module } from "@nestjs/common";
import { SmsService } from "./sms.service";
import { EgoSmsProvider } from "./ego-sms.provider";
import { SMS_PROVIDER } from "./sms-provider.interface";

@Module({
  providers: [SmsService, EgoSmsProvider, { provide: SMS_PROVIDER, useExisting: EgoSmsProvider }],
  exports: [SmsService],
})
export class SmsModule {}
