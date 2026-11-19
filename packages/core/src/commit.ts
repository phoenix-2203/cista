/**
 * Field commitments.
 *
 * Every payslip field is committed to on its own:
 *
 *   commitment = SHA-256("cista/field/v1" || len(name) || name || len(value) || value || salt)
 *
 * The salt is 32 bytes, derived per field from a random 32-byte payslip seed:
 *
 *   salt = HMAC-SHA-256(seed, "cista/salt/v1|" || name)
 *
 * Revealing one field means handing over its name, value and salt. The salt of
 * one field says nothing about the seed or the salts of the other fields, so
 * the rest stay hidden. SHA-256 is used (not SHA3) because the EVM has it as a
 * precompile, so a contract can check the same commitments.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, lengthPrefixed, utf8 } from "./bytes";
import type { Field } from "./payslip";

export const FIELD_DOMAIN = "cista/field/v1";
export const SALT_DOMAIN = "cista/salt/v1|";
export const SEED_BYTES = 32;

export function randomSeed(): Uint8Array {
  const seed = new Uint8Array(SEED_BYTES);
  crypto.getRandomValues(seed);
  return seed;
}

export function fieldSalt(seed: Uint8Array, name: string): Uint8Array {
  if (seed.length !== SEED_BYTES) throw new Error(`payslip seed must be ${SEED_BYTES} bytes`);
  return hmac(sha256, seed, utf8(SALT_DOMAIN + name));
}

export function fieldCommitment(field: Field, salt: Uint8Array): Uint8Array {
  if (salt.length !== 32) throw new Error("field salt must be 32 bytes");
  return sha256(concat(utf8(FIELD_DOMAIN), lengthPrefixed(utf8(field.name)), lengthPrefixed(utf8(field.value)), salt));
}

/** Commitments for a payslip's fields, in field order. */
export function commitFields(fields: Field[], seed: Uint8Array): Uint8Array[] {
  return fields.map((f) => fieldCommitment(f, fieldSalt(seed, f.name)));
}
