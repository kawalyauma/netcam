export type GatewayTransactionStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "INDETERMINATE";

export interface InitiateDepositParams {
  externalReference: string;
  msisdnDigits: string;
  amount: number;
  currency: string;
  reason: string;
  payerName?: string;
}

export interface InitiateDepositResult {
  ok: boolean;
  /**
   * True when we never got an answer (timeout, network error): the request
   * may or may not have reached the gateway. Payouts must then be settled by
   * polling getStatus, never retried blindly.
   */
  uncertain?: boolean;
  transactionStatus?: GatewayTransactionStatus;
  providerRef?: string; // gateway's own wallet reference
  financialTransactionId?: string;
  errorMessage?: string;
}

export interface StatusResult {
  ok: boolean;
  transactionStatus?: GatewayTransactionStatus;
  externalReference?: string;
  providerRef?: string;
  financialTransactionId?: string;
  amount?: number;
  currency?: string;
  errorMessage?: string;
}

export type InitiateWithdrawalParams = InitiateDepositParams;

export interface BalanceResult {
  ok: boolean;
  amount?: number;
  currency?: string;
  errorMessage?: string;
}

export interface PaymentGateway {
  initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult>;
  /** Pays out from the wallet to a mobile-money number. */
  initiateWithdrawal(params: InitiateWithdrawalParams): Promise<InitiateDepositResult>;
  getStatus(externalReference: string): Promise<StatusResult>;
  getBalance(currency: string): Promise<BalanceResult>;
}

export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
