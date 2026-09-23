import { Body, Controller, Get, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { SessionsService } from "./sessions.service";
import { ReportTrafficDto } from "./dto/report-traffic.dto";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  @Get("active")
  findActive() {
    return this.service.findActive();
  }

  @Public()
  @Post("traffic-report")
  reportTraffic(@Body() dto: ReportTrafficDto, @Headers("x-netcam-secret") secret: string) {
    if (secret !== (process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret")) {
      throw new UnauthorizedException();
    }
    return this.service.reportTraffic(dto);
  }
}
