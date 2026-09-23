import { Module } from "@nestjs/common";
import { NetworkAgentBridgeService } from "./network-agent-bridge.service";
import { NetworkAgentBridgeController } from "./network-agent-bridge.controller";
import { RoutersModule } from "../routers/routers.module";

@Module({
  imports: [RoutersModule],
  providers: [NetworkAgentBridgeService],
  controllers: [NetworkAgentBridgeController],
  exports: [NetworkAgentBridgeService],
})
export class NetworkAgentBridgeModule {}
