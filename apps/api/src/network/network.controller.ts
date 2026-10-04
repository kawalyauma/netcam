import { Controller, Get } from "@nestjs/common";
import { NetworkService } from "./network.service";

@Controller("network")
export class NetworkController {
  constructor(private readonly service: NetworkService) {}

  /** Live routers (with chain) + online client devices, split into paid vs held at the portal. */
  @Get("live")
  live() {
    return this.service.live();
  }
}
