export interface AdminUser {
  id: string;
  email: string;
  fullName?: string | null;
  role: "SUPER_ADMIN" | "OPERATOR";
}

export interface OutputChannel {
  id: string;
  name: string;
  interfaceName: string;
  type: "ETHERNET" | "WIFI_AP" | "USB_ETHERNET";
  isActive: boolean;
  macAddress?: string | null;
  notes?: string | null;
}

export interface RouterNode {
  id: string;
  name: string;
  macAddress?: string | null;
  ipAddress?: string | null;
  model?: string | null;
  location?: string | null;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
  lastSeenAt?: string | null;
  vlanId?: number | null;
  subnetCidr?: string | null;
  apSsid?: string | null;
  outputChannelId?: string | null;
  parentRouterId?: string | null;
  outputChannel?: OutputChannel | null;
  children?: RouterNode[];
}

export interface Package {
  id: string;
  name: string;
  description?: string | null;
  priceUgx: number;
  limitType: "DURATION" | "DATA_CAP" | "DURATION_AND_DATA_CAP";
  durationMinutes?: number | null;
  dataCapMb?: number | null;
  downKbps: number;
  upKbps: number;
  deviceLimit: number;
  isActive: boolean;
}

export interface Voucher {
  id: string;
  code: string;
  status: "UNUSED" | "ACTIVE" | "EXPIRED" | "DEPLETED" | "SUSPENDED";
  package: Package;
  activatedAt?: string | null;
  expiresAt?: string | null;
  dataUsedMb: number;
  batchLabel?: string | null;
  devices?: Array<{ id: string; macAddress: string; isBlocked: boolean }>;
}

export interface Payment {
  id: string;
  provider: string;
  amountUgx: number;
  status: "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED";
  customer: { phoneNumber: string; name?: string | null };
  package: Package;
  voucher?: { code: string } | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface DashboardOverview {
  routers: { total: number; online: number; offline: number };
  activeSessions: number;
  usersOnline: { total: number; paid: number; atPortal: number } | null;
  activeVouchers: number;
  todayRevenueUgx: number;
  todaySmsSent: number;
  suspectedResharing: number;
  generatedAt: string;
}

export interface RouterUserCount {
  id: string;
  name: string;
  status: string;
  vlanId?: number | null;
  activeUsers: number;
}

export interface LiveRouter {
  id: string;
  name: string;
  model: string | null;
  location: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  parentRouterId: string | null;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
  onlineReason: "ping" | "clients" | "downstream" | null;
  pingMs: number | null;
  lastSeenAt: string | null;
  isSegmentRoot: boolean;
  children: LiveRouter[];
}

export interface LiveDevice {
  macAddress: string;
  ipAddress: string | null;
  hostname: string | null;
  interfaceName: string | null;
  pingMs: number | null;
  online: boolean;
  access: "PAID" | "BLOCKED";
  isBlockedByAdmin: boolean;
  voucher: {
    code: string;
    status: Voucher["status"];
    packageName: string;
    expiresAt: string | null;
    customerPhone: string | null;
  } | null;
}

export interface NetworkLive {
  generatedAt: string;
  segments: Array<{ routerId: string; interfaceName: string; subnetCidr: string; gatewayIp: string }>;
  summary: { routersOnline: number; routersTotal: number; devicesOnline: number; devicesPaid: number; devicesBlocked: number; paidTotal: number };
  routers: LiveRouter[];
  devices: LiveDevice[];
}

export interface EarningsSummary {
  rangeDays: number;
  timeZone: string;
  totals: {
    todayUgx: number;
    last7DaysUgx: number;
    rangeUgx: number;
    allTimeUgx: number;
    averagePerDayUgx: number;
    averagePaymentUgx: number;
  };
  counts: {
    success: number;
    pending: number;
    failed: number;
    cancelled: number;
    allTimeSuccess: number;
    vouchersSold: number;
    successRate: number | null;
  };
  daily: Array<{ date: string; revenueUgx: number; mobileMoneyUgx: number; voucherUgx: number; payments: number }>;
  byPackage: Array<{ packageId: string; name: string; revenueUgx: number; payments: number }>;
  bySource: Array<{ source: "SSENTEZO" | "MANUAL" | "VOUCHER"; revenueUgx: number; sales: number }>;
}

export interface FeeSchedule {
  minAmountUgx: number;
  maxAmountUgx: number;
  bandSizeUgx: number;
  baseFeeUgx: number;
  stepFeeUgx: number;
}

export interface FeeInfo {
  schedule: FeeSchedule;
  tiers: Array<{ fromUgx: number; toUgx: number; feeUgx: number }>;
}

export interface WithdrawalBalance {
  earnedUgx: number;
  onHoldUgx: number;
  withdrawnUgx: number;
  feesPaidUgx: number;
  availableUgx: number;
}

export type WithdrawalStatus = "REQUESTED" | "PROCESSING" | "SUCCESS" | "FAILED" | "REJECTED" | "CANCELLED";

export interface Withdrawal {
  id: string;
  amountUgx: number;
  feeUgx: number;
  phoneNumber: string;
  recipientName: string | null;
  note: string | null;
  status: WithdrawalStatus;
  requestedById: string;
  requestedBy: { email: string; fullName: string | null };
  reviewedBy: { email: string; fullName: string | null } | null;
  reviewNote: string | null;
  failureReason: string | null;
  financialTransactionId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  completedAt: string | null;
}

export type LedgerEntryType = "INCOME" | "EXPENSE";
export type LedgerPaymentMethod = "CASH" | "MOBILE_MONEY" | "BANK" | "OTHER";

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  category: string;
  amountUgx: number;
  occurredOn: string;
  description: string | null;
  paymentMethod: LedgerPaymentMethod;
  createdBy: { email: string; fullName: string | null };
  createdAt: string;
}

export interface LedgerCategoryRow {
  category: string;
  amountUgx: number;
  count: number;
  automatic: boolean;
}

export interface LedgerSummary {
  from: string;
  to: string;
  timeZone: string;
  totals: { incomeUgx: number; expenseUgx: number; profitUgx: number; withdrawnUgx: number };
  income: LedgerCategoryRow[];
  expenses: LedgerCategoryRow[];
  monthly: Array<{ month: string; incomeUgx: number; expenseUgx: number; profitUgx: number }>;
}
