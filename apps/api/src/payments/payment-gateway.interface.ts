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
  transactionStatus?: GatewayTransactionStatus;
  providerRef?: string; // gateway's own wallet reference
  financialTransactionId?: string;
  errorMessage?: string;
}

export interface StatusResult {
  ok: boolean;
  transactionStatus?: GatewayTransactionStatus;
  providerRef?: string;
  financialTransactionId?: string;
  amount?: number;
  errorMessage?: string;
}

export interface PaymentGateway {
  initiateDeposit(params: InitiateDepositParams): Promise<InitiateDepositResult>;
  getStatus(externalReference: string): Promise<StatusResult>;
}

export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");
