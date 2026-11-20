/**
 * The recovery phrase: 24 words, shown once when the sealing key is made.
 *
 * The sealing key is derived from the phrase (QoreSeal's standard derivation
 * from a BIP-39 mnemonic), and the password only locks a copy of it in the
 * browser. So a forgotten password is not a lost key: the phrase rebuilds the
 * same key, and every payslip already sealed to it opens again.
 *
 * The phrase is not the QoreX wallet's seed phrase and controls no funds. It
 * opens payslips only.
 */
import { sealKeysFromSeed, sealSeedFromMnemonic, type SealKeyPair } from "@qorechain/qoreseal";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const RECOVERY_WORDS = 24;

export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

/** Lowercases, trims and collapses spaces, so a phrase typed back in matches. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

export function isRecoveryPhrase(phrase: string): boolean {
  const p = normalizePhrase(phrase);
  return p.split(" ").length === RECOVERY_WORDS && validateMnemonic(p, wordlist);
}

/** The 32-byte sealing seed for a recovery phrase. */
export function seedFromPhrase(phrase: string): Uint8Array {
  const p = normalizePhrase(phrase);
  if (!isRecoveryPhrase(p)) throw new Error("that is not a valid 24-word recovery phrase; check each word and its order");
  return sealSeedFromMnemonic({ mnemonic: p, index: 0 });
}

export function keysFromPhrase(phrase: string): SealKeyPair {
  return sealKeysFromSeed(seedFromPhrase(phrase));
}
