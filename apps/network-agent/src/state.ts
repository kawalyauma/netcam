import type { RouterVlanConfig } from "./config";

export interface AdmittedMac {
  mac: string;
  router: RouterVlanConfig;
  sessionExpiresAt: number; // epoch ms
  lastDownBytes: number;
  lastUpBytes: number;
}

/** In-memory registry of currently-admitted MACs. Rebuilt from nft on startup if the agent restarts (see reconcile.ts). */
export const admitted = new Map<string, AdmittedMac>();
