/**
 * "Stay unlocked in this tab": after the password unlocks the sealing key,
 * its seed is kept for this tab only, encrypted with an AES-GCM key the
 * browser marks non-extractable (it lives in IndexedDB and its bytes can
 * never be read out, not even by this page). The encrypted seed sits in
 * sessionStorage, which the browser drops when the tab closes.
 *
 * So a reload no longer asks for the password, but a copied disk or a
 * different tab gets nothing usable. After 30 minutes without use the tab
 * locks again.
 */
import { fromHex, toHex } from "@phoenix-2203/cista";

export const IDLE_MS = 30 * 60_000;
const DB = "cista";
const STORE = "keys";
const KEY_ID = "tab-wrap-v1";
const slot = (address: string) => `cista.tab.${address}`;

interface Wrapped {
  iv: string;
  box: string;
  until: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function wrapKey(create: boolean): Promise<CryptoKey | null> {
  const db = await openDb();
  const get = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const existing = await get(db.transaction(STORE).objectStore(STORE).get(KEY_ID)) as CryptoKey | undefined;
  if (existing || !create) return existing ?? null;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await get(db.transaction(STORE, "readwrite").objectStore(STORE).put(key, KEY_ID));
  return key;
}

const ad = (address: string) => new TextEncoder().encode(`cista/tab/v1|${address}`);

export async function rememberSeed(address: string, seed: Uint8Array): Promise<void> {
  try {
    const key = (await wrapKey(true))!;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const box = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad(address) }, key, new Uint8Array(seed)));
    const w: Wrapped = { iv: toHex(iv), box: toHex(box), until: Date.now() + IDLE_MS };
    sessionStorage.setItem(slot(address), JSON.stringify(w));
  } catch {
    /* no IndexedDB or storage: the key just stays in memory for this page */
  }
}

/** The remembered seed for this tab, or null if there is none or it went idle. */
export async function recallSeed(address: string): Promise<Uint8Array | null> {
  try {
    const raw = sessionStorage.getItem(slot(address));
    if (!raw) return null;
    const w = JSON.parse(raw) as Wrapped;
    if (Date.now() > w.until) {
      forgetSeed(address);
      return null;
    }
    const key = await wrapKey(false);
    if (!key) return null;
    const seed = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(fromHex(w.iv)), additionalData: ad(address) }, key, new Uint8Array(fromHex(w.box))),
    );
    sessionStorage.setItem(slot(address), JSON.stringify({ ...w, until: Date.now() + IDLE_MS }));
    return seed;
  } catch {
    forgetSeed(address);
    return null;
  }
}

/** Pushes the idle lock back while the key is in use. */
export function touchSeed(address: string): void {
  try {
    const raw = sessionStorage.getItem(slot(address));
    if (raw) sessionStorage.setItem(slot(address), JSON.stringify({ ...(JSON.parse(raw) as Wrapped), until: Date.now() + IDLE_MS }));
  } catch {
    /* ignore */
  }
}

export function forgetSeed(address: string): void {
  try {
    sessionStorage.removeItem(slot(address));
  } catch {
    /* ignore */
  }
}
