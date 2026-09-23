import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/** Symmetric encryption for small secrets at rest (router AP passwords). */
const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? "insecure-dev-secret";
  return scryptSync(secret, "netcam-static-salt", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
