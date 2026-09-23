import { Module } from "@nestjs/common";
import { OutputChannelsService } from "./output-channels.service";
import { OutputChannelsController } from "./output-channels.controller";

@Module({
  providers: [OutputChannelsService],
  controllers: [OutputChannelsController],
  exports: [OutputChannelsService],
})
export class OutputChannelsModule {}
