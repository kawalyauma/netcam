import { customAlphabet } from "nanoid";

// Excludes ambiguous chars (0/O, 1/I/L) so vouchers are easy to read off a
// printed slip and type on a phone keyboard.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const nano = customAlphabet(ALPHABET, 4);

export function generateVoucherCode(): string {
  return `${nano()}-${nano()}-${nano()}`;
}
