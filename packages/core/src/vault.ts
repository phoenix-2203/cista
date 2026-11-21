/**
 * The sealing key vault: the 32-byte QoreSeal seed, encrypted with a password.
 *
 * QoreX cannot hand a website its keys, so the sealing keys Cista uses are
 * made in the browser. Their seed is kept only in this encrypted form
 * (in the browser, and in a backup file the user downloads):
 *
 *   key = Argon2id(password, 16-byte salt, 64 MiB, 3 passes, 1 lane)   (RFC 9106)
 *   box = AES-256-GCM(key, 12-byte IV, seed, aad = "cista/vault/v1|" + address)
 *
 * Argon2id is memory-hard: each guess needs 64 MiB, which is what makes
 * password-guessing on graphics cards expensive. It runs in plain JavaScript
 * (@noble/hashes), so the page's strict CSP needs no WebAssembly exception.
 * Vaults made before used PBKDF2-SHA-256 with 600,000 rounds; they still open,
 * and the app re-locks them with Argon2id on the next unlock.
 *
 * The address in the additional data stops one account's vault being passed
 * off as another's. Losing both the vault and the password loses the key; the
 * employer can then re-seal past payslips to the new one.
 */
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { fromHex, toHex, utf8 } from "./bytes";

/** The PBKDF2 rounds of vaults made before Argon2id. */
export const VAULT_ROUNDS = 600_000;
/** Argon2id settings for new vaults: 64 MiB, 3 passes, 1 lane. */
export const ARGON2 = { m: 65_536, t: 3, p: 1 } as const;

/** A copy backed by a plain ArrayBuffer, as WebCrypto's types require. */
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

interface VaultBox {
  v: 1;
  address: string;
  salt: string;
  iv: string;
  box: string;
}
export interface Pbkdf2Vault extends VaultBox {
  kdf: "pbkdf2-sha256";
  rounds: number;
}
export interface Argon2Vault extends VaultBox {
  kdf: "argon2id";
  /** Memory in KiB, passes, lanes. */
  m: number;
  t: number;
  p: number;
}
export type Vault = Pbkdf2Vault | Argon2Vault;

/** True for a vault made with the older PBKDF2 settings. */
export const needsUpgrade = (v: Vault): boolean => v.kdf !== "argon2id";

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

async function pbkdf2Key(password: string, salt: Uint8Array, rounds: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", buf(utf8(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations: rounds },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function argon2Key(password: string, salt: Uint8Array, o: { m: number; t: number; p: number }): Promise<CryptoKey> {
  const raw = await argon2idAsync(utf8(password), salt, { m: o.m, t: o.t, p: o.p, dkLen: 32 });
  try {
    return await crypto.subtle.importKey("raw", buf(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}

function checkParams(v: Vault): void {
  const ok =
    v.kdf === "pbkdf2-sha256"
      ? Number.isInteger(v.rounds) && v.rounds >= 100_000 && v.rounds <= 10_000_000
      : [v.m, v.t, v.p].every(Number.isInteger) && v.m >= 19_456 && v.m <= 1_048_576 && v.t >= 1 && v.t <= 10 && v.p >= 1 && v.p <= 4;
  if (!ok) throw new VaultError("this key backup is damaged");
}

const vaultKey = (v: Vault, password: string) =>
  v.kdf === "argon2id" ? argon2Key(password, fromHex(v.salt), v) : pbkdf2Key(password, fromHex(v.salt), v.rounds);

/**
 * Locks the seed under a password. New vaults use Argon2id; `kdf` can ask for
 * the older PBKDF2 form (kept for tests and for reading old backups).
 */
export async function lockSeed(
  seed: Uint8Array,
  password: string,
  address: string,
  kdf: { kdf: "argon2id"; m: number; t: number; p: number } | { kdf: "pbkdf2-sha256"; rounds: number } = { kdf: "argon2id", ...ARGON2 },
): Promise<Vault> {
  if (seed.length !== 32) throw new VaultError("the seed must be 32 bytes");
  if (password.length < 10) throw new VaultError("use a password of at least 10 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = { v: 1 as const, address, salt: toHex(salt), iv: toHex(iv), box: "" };
  const vault: Vault = kdf.kdf === "argon2id" ? { ...head, kdf: "argon2id", m: kdf.m, t: kdf.t, p: kdf.p } : { ...head, kdf: "pbkdf2-sha256", rounds: kdf.rounds };
  checkParams(vault);
  const key = await vaultKey(vault, password);
  vault.box = toHex(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: buf(utf8(`cista/vault/v1|${address}`)) }, key, buf(seed))));
  return vault;
}

export async function unlockSeed(vault: Vault, password: string, address: string): Promise<Uint8Array> {
  if (vault?.v !== 1 || (vault.kdf !== "pbkdf2-sha256" && vault.kdf !== "argon2id")) throw new VaultError("this is not a Cista key backup");
  if (vault.address !== address) throw new VaultError(`this key backup belongs to ${vault.address}, not ${address}`);
  checkParams(vault);
  let seed: ArrayBuffer;
  try {
    const key = await vaultKey(vault, password);
    seed = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(fromHex(vault.iv)), additionalData: buf(utf8(`cista/vault/v1|${address}`)) }, key, buf(fromHex(vault.box)));
  } catch {
    throw new VaultError("wrong password, or the key backup is damaged");
  }
  return new Uint8Array(seed);
}
