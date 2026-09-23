/**
 * Plain `{ key: value } as const` objects instead of `enum` — Prisma's
 * generated client types its enum fields as string-literal unions, and TS
 * `enum` members are nominally typed (not structurally assignable to a
 * matching literal union even when the values are identical). This shape
 * is assignable both ways and still works with class-validator's @IsEnum.
 */

export const AdminRole = {
  SUPER_ADMIN: "SUPER_ADMIN",
  OPERATOR: "OPERATOR",
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const RouterStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  UNKNOWN: "UNKNOWN",
} as const;
export type RouterStatus = (typeof RouterStatus)[keyof typeof RouterStatus];

export const OutputChannelType = {
  ETHERNET: "ETHERNET",
  WIFI_AP: "WIFI_AP",
  USB_ETHERNET: "USB_ETHERNET",
} as const;
export type OutputChannelType = (typeof OutputChannelType)[keyof typeof OutputChannelType];

export const PackageLimitType = {
  DURATION: "DURATION",
  DATA_CAP: "DATA_CAP",
  DURATION_AND_DATA_CAP: "DURATION_AND_DATA_CAP",
} as const;
export type PackageLimitType = (typeof PackageLimitType)[keyof typeof PackageLimitType];

export const VoucherStatus = {
  UNUSED: "UNUSED",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  DEPLETED: "DEPLETED",
  SUSPENDED: "SUSPENDED",
} as const;
export type VoucherStatus = (typeof VoucherStatus)[keyof typeof VoucherStatus];

export const PaymentProvider = {
  SSENTEZO: "SSENTEZO",
  MANUAL: "MANUAL",
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export const PaymentStatus = {
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const SmsProviderName = {
  EGO_SMS: "EGO_SMS",
} as const;
export type SmsProviderName = (typeof SmsProviderName)[keyof typeof SmsProviderName];

export const SmsStatus = {
  QUEUED: "QUEUED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
} as const;
export type SmsStatus = (typeof SmsStatus)[keyof typeof SmsStatus];
