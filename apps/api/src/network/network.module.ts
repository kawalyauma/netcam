import { Module } from "@nestjs/common";
import { NetworkService } from "./network.service";
import { NetworkController } from "./network.controller";
import { RoutersModule } from "../routers/routers.module";
import { NetworkAgentBridgeModule } from "../network-agent-bridge/network-agent-bridge.module";

@Module({
  imports: [RoutersModule, NetworkAgentBridgeModule],
  providers: [NetworkService],
  controllers: [NetworkController],
  exports: [NetworkService],
})
export class NetworkModule {}
