import { Module } from "@nestjs/common";
import { UsageService } from "./usage.service";
import { UsageController } from "./usage.controller";
import { NetworkAgentBridgeModule } from "../network-agent-bridge/network-agent-bridge.module";

@Module({
  imports: [NetworkAgentBridgeModule],
  providers: [UsageService],
  controllers: [UsageController],
})
export class UsageModule {}
