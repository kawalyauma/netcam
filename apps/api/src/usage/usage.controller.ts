import { Controller, Get, Query } from "@nestjs/common";
import { UsageService } from "./usage.service";

@Controller("usage")
export class UsageController {
  constructor(private readonly service: UsageService) {}

  /** Per-device rates at 5-second resolution, polled by the Usage page. */
  @Get("live")
  live() {
    return this.service.live();
  }

  /** History: range=24h (hourly), 7d or 30d (daily). Add mac=XX:XX:... for one device. */
  @Get("summary")
  summary(@Query("range") range = "24h", @Query("mac") mac?: string) {
    return this.service.summary(range, mac);
  }
}
