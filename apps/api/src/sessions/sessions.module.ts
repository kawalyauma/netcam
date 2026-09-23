import { Module } from "@nestjs/common";
import { SessionsService } from "./sessions.service";
import { SessionsController } from "./sessions.controller";
import { NetworkAgentBridgeModule } from "../network-agent-bridge/network-agent-bridge.module";

@Module({
  imports: [NetworkAgentBridgeModule],
  providers: [SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
