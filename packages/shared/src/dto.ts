/**
 * Wire-format DTOs shared between the API, admin dashboard, captive portal,
 * and network-agent. Kept framework-agnostic (no class-validator decorators
 * here) so @netcam/portal can stay dependency-light.
 */

export interface PortalRedeemRequest {
  voucherCode: string;
  macAddress: string;
  routerVlanId?: number;
}

export interface PortalRedeemResponse {
  ok: boolean;
  message: string;
  sessionExpiresAt?: string;
  remainingDataMb?: number;
}

export interface PortalRecoverRequest {
  phoneNumber: string;
}

export interface PortalRecoverConfirmRequest {
  phoneNumber: string;
  otp: string;
}

export interface PortalStatusResponse {
  authorized: boolean;
  voucherCode?: string;
  expiresAt?: string;
  remainingDataMb?: number;
  remainingSeconds?: number;
}

export interface NetworkAgentAdmitCommand {
  macAddress: string;
  ipAddress?: string;
  routerId: string;
  voucherId: string;
  downKbps: number;
  upKbps: number;
  sessionExpiresAt: string;
}

export interface NetworkAgentRevokeCommand {
  macAddress: string;
  reason: string;
}

export interface NetworkAgentHeartbeat {
  routerId: string;
  vlanId: number;
  interfaceName: string;
  connectedMacs: string[];
  timestamp: string;
}
