import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance } from "axios";
import type {
  GatewayTransactionStatus,
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

  constructor() {
    const baseURL = process.env.SSENTEZO_BASE_URL ?? "https://wallet.ssentezo.com/api";
    const apiUser = process.env.SSENTEZO_API_USER ?? "";
    const apiKey = process.env.SSENTEZO_API_KEY ?? "";
    this.http = axios.create({
      baseURL,
      timeout: 15_000,
      auth: { username: apiUser, password: apiKey },
      headers: { "Content-Type": "application/json" },
      validateStatus: () => true, // we inspect status + body.response ourselves
    });
  }

  async initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult> {
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

    const res = await this.http.post("/deposit", body);
    if (res.status !== 202 && res.status !== 200) {
      this.logger.warn(`Ssentezo deposit init failed (${res.status}): ${JSON.stringify(res.data)}`);
      return { ok: false, errorMessage: res.data?.error?.message ?? `HTTP ${res.status}` };
    }
    if (res.data?.response !== "OK") {
      return { ok: false, errorMessage: res.data?.error?.message ?? "Unknown Ssentezo error" };
    }

    const data = res.data.data as {
      transactionStatus: GatewayTransactionStatus;
      ssentezoWalletReference: string;
      financialTransactionId: string;
    };
    return {
      ok: true,
      transactionStatus: data.transactionStatus,
      providerRef: data.ssentezoWalletReference,
      financialTransactionId: data.financialTransactionId,
    };
  }

  async getStatus(externalReference: string): Promise<StatusResult> {
    const res = await this.http.post(`/get_status/${encodeURIComponent(externalReference)}`);
    if (res.data?.response !== "OK") {
      return { ok: false, errorMessage: res.data?.error?.message ?? `HTTP ${res.status}` };
    }
    const data = res.data.data as {
      transactionStatus: GatewayTransactionStatus;
      ssentezoWalletReference: string;
      financialTransactionId: string;
      amount: number;
    };
    return {
      ok: true,
      transactionStatus: data.transactionStatus,
      providerRef: data.ssentezoWalletReference,
      financialTransactionId: data.financialTransactionId,
      amount: data.amount,
    };
  }
}
