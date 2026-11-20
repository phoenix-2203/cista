/**
 * The sealing key vault: the 32-byte QoreSeal seed, encrypted with a password.
 *
 * QoreX cannot hand a website its keys, so the sealing keys Cista uses are
 * made in the browser. Their seed is kept only in this encrypted form
 * (in the browser, and in a backup file the user downloads):
 *
 *   key = PBKDF2-SHA-256(password, 16-byte salt, 600,000 rounds)
 *   box = AES-256-GCM(key, 12-byte IV, seed, aad = "cista/vault/v1|" + address)
 *
 * The address in the additional data stops one account's vault being passed
 * off as another's. Losing both the vault and the password loses the key; the
 * employer can then re-seal past payslips to the new one.
 */
import { fromHex, toHex, utf8 } from "./bytes";

export const VAULT_ROUNDS = 600_000;

/** A copy backed by a plain ArrayBuffer, as WebCrypto's types require. */
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

export interface Vault {
  v: 1;
  address: string;
  kdf: "pbkdf2-sha256";
  rounds: number;
  salt: string;
  iv: string;
  box: string;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

async function keyFrom(password: string, salt: Uint8Array, rounds: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", buf(utf8(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations: rounds },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function lockSeed(seed: Uint8Array, password: string, address: string, rounds = VAULT_ROUNDS): Promise<Vault> {
  if (seed.length !== 32) throw new VaultError("the seed must be 32 bytes");
  if (password.length < 10) throw new VaultError("use a password of at least 10 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(password, salt, rounds);
  const box = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: buf(utf8(`cista/vault/v1|${address}`)) }, key, buf(seed)));
  return { v: 1, address, kdf: "pbkdf2-sha256", rounds, salt: toHex(salt), iv: toHex(iv), box: toHex(box) };
}

export async function unlockSeed(vault: Vault, password: string, address: string): Promise<Uint8Array> {
  if (vault?.v !== 1 || vault.kdf !== "pbkdf2-sha256") throw new VaultError("this is not a Cista key backup");
  if (vault.address !== address) throw new VaultError(`this key backup belongs to ${vault.address}, not ${address}`);
  if (!Number.isInteger(vault.rounds) || vault.rounds < 100_000 || vault.rounds > 10_000_000) throw new VaultError("this key backup is damaged");
  let seed: ArrayBuffer;
  try {
    const key = await keyFrom(password, fromHex(vault.salt), vault.rounds);
    seed = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(fromHex(vault.iv)), additionalData: buf(utf8(`cista/vault/v1|${address}`)) }, key, buf(fromHex(vault.box)));
  } catch {
    throw new VaultError("wrong password, or the key backup is damaged");
  }
  return new Uint8Array(seed);
}
