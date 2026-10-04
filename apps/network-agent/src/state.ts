import type { RouterVlanConfig } from "./config";

export interface AdmittedMac {
  mac: string;
  router: RouterVlanConfig;
  sessionExpiresAt: number; // epoch ms
  downKbps: number;
  upKbps: number;
  admittedAt: number; // epoch ms
  lastDownBytes: number;
  lastUpBytes: number;
}

/** In-memory registry of currently-admitted MACs, rebuilt from the API on startup (see admission.ts). */
export const admitted = new Map<string, AdmittedMac>();
