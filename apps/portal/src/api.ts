const BASE = "/portal";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    throw new Error(body.message ?? "Something went wrong. Please try again.");
  }
  return body;
}

export interface Package {
  id: string;
  name: string;
  priceUgx: number;
  limitType: string;
  durationMinutes?: number;
  dataCapMb?: number;
}

export interface PortalStatus {
  authorized: boolean;
  voucherCode?: string;
  expiresAt?: string;
  remainingDataMb?: number;
}

export const api = {
  getPackages: () => request<Package[]>("/packages"),
  status: () => request<PortalStatus>("/status"),
  pay: (packageId: string, phoneNumber: string) =>
    request<{ paymentId: string; status: string; message: string }>("/pay", {
      method: "POST",
      body: JSON.stringify({ packageId, phoneNumber }),
    }),
  payStatus: (paymentId: string) =>
    request<{ status: string; voucherCode?: string }>(`/pay/${paymentId}/status`),
  redeem: (voucherCode: string) =>
    request<{ ok: boolean; message: string }>("/redeem", {
      method: "POST",
      body: JSON.stringify({ voucherCode }),
    }),
  recover: (phoneNumber: string) =>
    request<{ ok: boolean }>("/recover", { method: "POST", body: JSON.stringify({ phoneNumber }) }),
  recoverConfirm: (phoneNumber: string, otp: string) =>
    request<{ voucherCode: string; packageName: string }>("/recover/confirm", {
      method: "POST",
      body: JSON.stringify({ phoneNumber, otp }),
    }),
};
