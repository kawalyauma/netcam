import { Module } from "@nestjs/common";
import { VouchersService } from "./vouchers.service";
import { VouchersController } from "./vouchers.controller";
import { NetworkAgentBridgeModule } from "../network-agent-bridge/network-agent-bridge.module";

@Module({
  imports: [NetworkAgentBridgeModule],
  providers: [VouchersService],
  controllers: [VouchersController],
  exports: [VouchersService],
})
export class VouchersModule {}
