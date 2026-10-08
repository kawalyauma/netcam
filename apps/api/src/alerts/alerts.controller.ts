import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AdminRole } from "@netcam/shared";
import { AlertSeverity } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { Roles } from "../auth/decorators/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsAppHubService } from "../whatsapp/whatsapp-hub.service";
import { ALERT_CATEGORIES, AlertsService } from "./alerts.service";

const CATEGORY_KEYS = Object.keys(ALERT_CATEGORIES);

class RecipientDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  /** Ugandan numbers in international digits, e.g. 256746363932. */
  @Matches(/^256\d{9}$/, { message: "phoneNumber must look like 2567XXXXXXXX" })
  phoneNumber!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CATEGORY_KEYS, { each: true })
  categories?: string[];

  @IsOptional()
  @IsEnum(AlertSeverity)
  minSeverity?: AlertSeverity;

  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class UpdateRecipientDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @Matches(/^256\d{9}$/, { message: "phoneNumber must look like 2567XXXXXXXX" })
  phoneNumber?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CATEGORY_KEYS, { each: true })
  categories?: string[];

  @IsOptional()
  @IsEnum(AlertSeverity)
  minSeverity?: AlertSeverity;

  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class EventsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

@Controller("alerts")
export class AlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly whatsapp: WhatsAppHubService,
  ) {}

  @Get("meta")
  meta() {
    return {
      categories: Object.entries(ALERT_CATEGORIES).map(([key, label]) => ({ key, label })),
      severities: Object.values(AlertSeverity),
      whatsappConfigured: this.whatsapp.configured,
    };
  }

  @Get("recipients")
  recipients() {
    return this.prisma.alertRecipient.findMany({ orderBy: { createdAt: "asc" } });
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post("recipients")
  create(@Body() dto: RecipientDto) {
    return this.prisma.alertRecipient.create({ data: dto });
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Patch("recipients/:id")
  update(@Param("id") id: string, @Body() dto: UpdateRecipientDto) {
    return this.prisma.alertRecipient.update({ where: { id }, data: dto });
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Delete("recipients/:id")
  remove(@Param("id") id: string) {
    return this.prisma.alertRecipient.delete({ where: { id } });
  }

  @Get("events")
  events(@Query() q: EventsQuery) {
    return this.prisma.alertEvent.findMany({ orderBy: { createdAt: "desc" }, take: q.limit ?? 100 });
  }

  /** Sends a test alert to every enabled recipient, whatever categories they picked. */
  @Roles(AdminRole.SUPER_ADMIN, AdminRole.OPERATOR)
  @Post("test")
  async test() {
    const recipients = await this.prisma.alertRecipient.findMany({ where: { enabled: true } });
    const deliveries = await this.alerts.notifyRecipients(recipients, {
      category: "SYSTEM",
      severity: "CRITICAL",
      title: "Test alert",
      message: "This is a test from NetCam. If you got this, alerts reach you.",
    });
    return { ok: true, deliveries };
  }
}
