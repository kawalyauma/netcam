export interface SendSmsResult {
  ok: boolean;
  providerRef?: string;
  cost?: number;
  error?: string;
}

export interface SmsProvider {
  send(toPhoneDigits: string, message: string): Promise<SendSmsResult>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
