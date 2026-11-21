/**
 * Unlock with a passkey (Face ID, Touch ID, Windows Hello, a phone or a
 * security key) instead of typing the password.
 *
 * It uses the WebAuthn PRF extension: the passkey turns a fixed salt into a
 * 32-byte secret that never leaves it unless the person is verified (face,
 * fingerprint or PIN). Cista stretches that secret with HKDF into an AES key
 * and keeps the seed wrapped under it in this browser, next to the password
 * vault. Nothing goes to the server, and the password and recovery phrase
 * keep working as before.
 *
 *   secret = PRF(passkey, salt)                      (WebAuthn, user verified)
 *   key    = HKDF-SHA-256(secret, salt, "cista/passkey/v1|" + address)
 *   box    = AES-256-GCM(key, iv, seed, aad = "cista/passkey/v1|" + address)
 */
import { fromHex, toHex, utf8 } from "@phoenix-2203/cista";

export interface PasskeyWrap {
  v: 1;
  address: string;
  /** The credential's ID, base64url. */
  credential: string;
  salt: string;
  iv: string;
  box: string;
}

export class PasskeyError extends Error {}

const storeKey = (address: string) => `cista.passkey.${address}`;
const context = (address: string) => utf8(`cista/passkey/v1|${address}`);
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Can this browser make passkeys at all? (PRF support only shows when one is made.) */
export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof PublicKeyCredential !== "undefined";
}

export function savedPasskey(address: string): PasskeyWrap | null {
  try {
    const w = JSON.parse(localStorage.getItem(storeKey(address)) ?? "null") as PasskeyWrap | null;
    return w?.v === 1 && w.address === address ? w : null;
  } catch {
    return null;
  }
}

export function removePasskey(address: string): void {
  try {
    localStorage.removeItem(storeKey(address));
  } catch {
    /* nothing stored */
  }
}

async function aesKey(secret: Uint8Array, salt: Uint8Array, address: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", buf(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(context(address)) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/** Asks the passkey for its PRF secret for this salt; the person is verified first. */
async function prfSecret(credential: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const got = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: buf(credential) }],
      userVerification: "required",
      timeout: 120_000,
      extensions: { prf: { eval: { first: buf(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const first = (got?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
  if (!first) throw new PasskeyError("this passkey can't unlock Cista keys (it doesn't support the PRF extension)");
  return new Uint8Array(first);
}

/**
 * Makes a passkey for this account and wraps the seed under it. The seed comes
 * from the unlocked key in this tab.
 */
export async function enrollPasskey(address: string, seed: Uint8Array): Promise<PasskeyWrap> {
  if (!passkeysAvailable()) throw new PasskeyError("this browser can't make passkeys here");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  let made: PublicKeyCredential | null;
  try {
    made = (await navigator.credentials.create({
      publicKey: {
        rp: { name: "Cista" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `Cista key · ${address.slice(0, 10)}…${address.slice(-4)}`, displayName: "Cista key" },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 120_000,
        extensions: { prf: { eval: { first: buf(salt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new PasskeyError(e instanceof DOMException && e.name === "NotAllowedError" ? "the passkey wasn't made (cancelled or timed out)" : (e as Error).message);
  }
  if (!made) throw new PasskeyError("the passkey wasn't made");
  const credential = new Uint8Array(made.rawId);
  const ext = made.getClientExtensionResults() as PrfResults;
  if (ext.prf?.enabled === false) throw new PasskeyError("this device's passkeys can't unlock Cista keys (no PRF support); your password still works");
  // Some authenticators return the secret when the passkey is made; others only on first use.
  const secret = ext.prf?.results?.first ? new Uint8Array(ext.prf.results.first) : await prfSecret(credential, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret, salt, address);
  secret.fill(0);
  const box = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: buf(context(address)) }, key, buf(seed)));
  const wrap: PasskeyWrap = { v: 1, address, credential: b64url(credential), salt: toHex(salt), iv: toHex(iv), box: toHex(box) };
  localStorage.setItem(storeKey(address), JSON.stringify(wrap));
  return wrap;
}

/** Unwraps the seed with the passkey. */
export async function unlockWithPasskey(address: string, wrap = savedPasskey(address)): Promise<Uint8Array> {
  if (!wrap) throw new PasskeyError("no passkey is set up for this account in this browser");
  let secret: Uint8Array;
  try {
    secret = await prfSecret(fromB64url(wrap.credential), fromHex(wrap.salt));
  } catch (e) {
    if (e instanceof PasskeyError) throw e;
    throw new PasskeyError(e instanceof DOMException && e.name === "NotAllowedError" ? "the passkey didn't unlock (cancelled or timed out)" : (e as Error).message);
  }
  const key = await aesKey(secret, fromHex(wrap.salt), address);
  secret.fill(0);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(fromHex(wrap.iv)), additionalData: buf(context(address)) }, key, buf(fromHex(wrap.box))));
  } catch {
    throw new PasskeyError("that passkey doesn't open this account's key");
  }
}
