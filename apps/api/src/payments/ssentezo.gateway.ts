import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import type {
  BalanceResult,
  GatewayTransactionStatus,
  InitiateWithdrawalParams,
  InitiateDepositParams,
  InitiateDepositResult,
  PaymentGateway,
  StatusResult,
} from "./payment-gateway.interface";

/**
 * Ssentezo Wallet API client (mobile-money collection).
 * Docs: https://wallet.ssentezo.com/documentation
 *
 * Auth: HTTP Basic (apiUser:apiKey, base64). Envelope: { response: "OK"|"ERROR", data|error }.
 * We use POST /deposit to collect payment from the customer's mobile money
 * account, then either wait for the success/failure callback or poll
 * POST /get_status/{externalReference} — vendor boxes are typically behind
 * home WiFi with no public IP, so polling is the reliable default and the
 * callback (when PUBLIC_BASE_URL is set) is just a fast path.
 */
@Injectable()
export class SsentezoGateway implements PaymentGateway {
  private readonly logger = new Logger(SsentezoGateway.name);
  private readonly http: AxiosInstance;
  private readonly isConfigured: boolean;

  constructor() {
    const baseURL = process.env.SSENTEZO_BASE_URL ?? "https://wallet.ssentezo.com/api";
    const apiUser = process.env.SSENTEZO_API_USER ?? "";
    const apiKey = process.env.SSENTEZO_API_KEY ?? "";
    this.isConfigured = Boolean(apiUser.trim() && apiKey.trim());
    this.http = axios.create({
      baseURL,
      timeout: 15_000,
      auth: { username: apiUser, password: apiKey },
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true, // we inspect status + body.response ourselves
    });
  }

  async initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult> {
    if (!this.isConfigured) {
      return { ok: false, errorMessage: "Ssentezo API credentials are not configured" };
    }

    const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    const body: Record<string, unknown> = {
      externalReference: params.externalReference,
      amount: params.amount,
      msisdn: params.msisdnDigits,
      reason: params.reason,
      currency: params.currency,
    };
    if (params.payerName) body.name = params.payerName;
    if (publicBase) {
      body.success_callback = `${publicBase}/api/payments/webhook/ssentezo`;
      body.failure_callback = `${publicBase}/api/payments/webhook/ssentezo`;
    }

    try {
      const res = await this.http.post("/deposit", body);
      if ((res.status !== 202 && res.status !== 200) || res.data?.response !== "OK") {
        const errorMessage = extractSsentezoError(res.data, res.status);
        this.logger.warn(`Ssentezo deposit init failed (${res.status}): ${errorMessage}`);
        return { ok: false, errorMessage };
      }

      const data = res.data?.data;
      const transactionStatus = parseTransactionStatus(data?.transactionStatus);
      if (!transactionStatus) return { ok: false, errorMessage: "Ssentezo returned an invalid transaction status" };
      return {
        ok: true,
        transactionStatus,
        providerRef: stringOrUndefined(data?.ssentezoWalletReference),
        financialTransactionId: stringOrUndefined(data?.financialTransactionId),
      };
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? `Ssentezo is unreachable: ${error.message}`
        : "Ssentezo request failed";
      this.logger.warn(errorMessage);
      return { ok: false, errorMessage };
    }
  }

  /**
   * POST /withdraw — sends money from the Ssentezo wallet to a mobile-money
   * number. Same envelope and status lifecycle as /deposit; settle it via
   * getStatus(externalReference) or the callback.
   */
  async initiateWithdrawal(params: InitiateWithdrawalParams): Promise<InitiateDepositResult> {
    if (!this.isConfigured) {
      return { ok: false, errorMessage: "Ssentezo API credentials are not configured" };
    }

    const publicBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    const body: Record<string, unknown> = {
      externalReference: params.externalReference,
      amount: params.amount,
      msisdn: params.msisdnDigits,
      reason: params.reason,
      currency: params.currency,
    };
    if (params.payerName) body.name = params.payerName;
    if (publicBase) {
      body.success_callback = `${publicBase}/api/payments/webhook/ssentezo`;
      body.failure_callback = `${publicBase}/api/payments/webhook/ssentezo`;
    }

    try {
      const res = await this.http.post("/withdraw", body);
      if ((res.status !== 202 && res.status !== 200) || res.data?.response !== "OK") {
        const errorMessage = extractSsentezoError(res.data, res.status);
        this.logger.warn(`Ssentezo withdraw init failed (${res.status}): ${errorMessage}`);
        // A 5xx may still have been processed; only a 4xx is a definite "no".
        return { ok: false, errorMessage, uncertain: res.status >= 500 };
      }
      const data = res.data?.data;
      const transactionStatus = parseTransactionStatus(data?.transactionStatus);
      if (!transactionStatus) {
        return { ok: false, uncertain: true, errorMessage: "Ssentezo returned an invalid transaction status" };
      }
      return {
        ok: true,
        transactionStatus,
        providerRef: stringOrUndefined(data?.ssentezoWalletReference),
        financialTransactionId: stringOrUndefined(data?.financialTransactionId),
      };
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? `Ssentezo is unreachable: ${error.message}`
        : "Ssentezo withdraw request failed";
      this.logger.warn(errorMessage);
      return { ok: false, uncertain: true, errorMessage };
    }
  }

  /** POST /acc_balance — current wallet balance, for reconciling payouts. */
  async getBalance(currency: string): Promise<BalanceResult> {
    if (!this.isConfigured) {
      return { ok: false, errorMessage: "Ssentezo API credentials are not configured" };
    }
    try {
      const res = await this.http.post("/acc_balance", { currency });
      if ((res.status !== 200 && res.status !== 202) || res.data?.response !== "OK") {
        return { ok: false, errorMessage: extractSsentezoError(res.data, res.status) };
      }
      const data = res.data?.data;
      const amount = Number(data?.amount ?? data?.balance);
      return {
        ok: Number.isFinite(amount),
        amount: Number.isFinite(amount) ? amount : undefined,
        currency: stringOrUndefined(data?.currency)?.toUpperCase() ?? currency,
        errorMessage: Number.isFinite(amount) ? undefined : "Ssentezo returned no balance amount",
      };
    } catch (error) {
      return {
        ok: false,
        errorMessage: axios.isAxiosError(error) ? `Ssentezo is unreachable: ${error.message}` : "Ssentezo balance request failed",
      };
    }
  }

  async getStatus(externalReference: string): Promise<StatusResult> {
    if (!this.isConfigured) {
      return { ok: false, errorMessage: "Ssentezo API credentials are not configured" };
    }

    try {
      const res = await this.http.post(`/get_status/${encodeURIComponent(externalReference)}`);
      if ((res.status !== 200 && res.status !== 202) || res.data?.response !== "OK") {
        return { ok: false, errorMessage: extractSsentezoError(res.data, res.status) };
      }
      const data = res.data?.data;
      const transactionStatus = parseTransactionStatus(data?.transactionStatus);
      if (!transactionStatus) return { ok: false, errorMessage: "Ssentezo returned an invalid transaction status" };
      const amount = Number(data?.amount);
      return {
        ok: true,
        transactionStatus,
        externalReference: stringOrUndefined(data?.externalReference),
        providerRef: stringOrUndefined(data?.ssentezoWalletReference),
        financialTransactionId: stringOrUndefined(data?.financialTransactionId),
        amount: Number.isFinite(amount) ? amount : undefined,
        currency: stringOrUndefined(data?.currency)?.toUpperCase(),
      };
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? `Ssentezo is unreachable: ${error.message}`
        : "Ssentezo status request failed";
      return { ok: false, errorMessage };
    }
  }
}

const VALID_STATUSES = new Set<GatewayTransactionStatus>(["PENDING", "SUCCEEDED", "FAILED", "INDETERMINATE"]);

export function parseTransactionStatus(value: unknown): GatewayTransactionStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toUpperCase() as GatewayTransactionStatus;
  return VALID_STATUSES.has(normalized) ? normalized : undefined;
}

export function extractSsentezoError(body: unknown, httpStatus: number): string {
  if (!body || typeof body !== "object") return `Ssentezo HTTP ${httpStatus}`;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return `Ssentezo HTTP ${httpStatus}`;
  const typed = error as { message?: unknown; errors?: unknown };
  const message = typeof typed.message === "string" ? typed.message : `Ssentezo HTTP ${httpStatus}`;
  if (!typed.errors || typeof typed.errors !== "object") return message;
  const details = Object.values(typed.errors as Record<string, unknown>)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string");
  return details.length ? `${message}: ${details.join("; ")}` : message;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
