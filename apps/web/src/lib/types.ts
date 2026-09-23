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
