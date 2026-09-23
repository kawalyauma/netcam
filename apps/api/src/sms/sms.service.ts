import { Inject, Injectable, Logger } from "@nestjs/common";
import { SmsStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SMS_PROVIDER, type SmsProvider } from "./sms-provider.interface";

const MAX_ATTEMPTS = 3;

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
  ) {}

  /** Sends immediately and logs the outcome; caller decides whether to retry-queue on failure. */
  async sendNow(params: { toPhoneDigits: string; message: string; customerId?: string; paymentId?: string }) {
    const log = await this.prisma.smsLog.create({
      data: {
        toPhone: params.toPhoneDigits,
        message: params.message,
        customerId: params.customerId,
        paymentId: params.paymentId,
        status: SmsStatus.QUEUED,
        attempts: 1,
      },
    });

    const result = await this.provider.send(params.toPhoneDigits, params.message);

    await this.prisma.smsLog.update({
      where: { id: log.id },
      data: {
        status: result.ok ? SmsStatus.SENT : SmsStatus.FAILED,
        providerRef: result.providerRef,
        error: result.error,
        sentAt: result.ok ? new Date() : undefined,
      },
    });

    if (!result.ok) {
      this.logger.warn(`SMS to ${params.toPhoneDigits} failed: ${result.error}`);
    }
    return result;
  }

  /** Retries any FAILED SmsLog rows under the attempt cap. Intended to run on a schedule. */
  async retryFailed() {
    const failed = await this.prisma.smsLog.findMany({
      where: { status: SmsStatus.FAILED, attempts: { lt: MAX_ATTEMPTS } },
      take: 50,
    });

    for (const log of failed) {
      const result = await this.provider.send(log.toPhone, log.message);
      await this.prisma.smsLog.update({
        where: { id: log.id },
        data: {
          status: result.ok ? SmsStatus.SENT : SmsStatus.FAILED,
          providerRef: result.providerRef ?? log.providerRef,
          error: result.error,
          attempts: { increment: 1 },
          sentAt: result.ok ? new Date() : undefined,
        },
      });
    }
  }
}
