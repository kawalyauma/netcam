import { Module } from "@nestjs/common";
import { RoutersService } from "./routers.service";
import { RoutersController } from "./routers.controller";

@Module({
  providers: [RoutersService],
  controllers: [RoutersController],
  exports: [RoutersService],
})
export class RoutersModule {}
