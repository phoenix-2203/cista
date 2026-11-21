/**
 * The user's sealing keys in this browser.
 *
 * The key comes from a 24-word recovery phrase, shown once when it is made.
 * The password locks a copy in this browser (and in an optional backup file);
 * the phrase rebuilds the key if the password is forgotten. Once unlocked, the
 * key stays unlocked in this tab (see tabkey.ts) until the tab closes or sits
 * idle for 30 minutes.
 *
 * Both public keys (ML-KEM-1024 and X25519) are published in a key card that
 * the user signs in QoreX with their registered ML-DSA-87 key, so anyone can
 * check the keys are really theirs. (QoreX keeps registering an ML-KEM key in
 * the chain's KEM registry for the wallet itself: a website can't send
 * MsgRegisterKEMKey.)
 */
import { lockSeed, needsUpgrade, newRecoveryPhrase, seedFromPhrase, toHex, unlockSeed, type Vault } from "@phoenix-2203/cista";
import { assembleRecipientCard, recipientCardFields, recipientCardText, sealKeysFromSeed, type RecipientCard, type SealKeyPair } from "@qorechain/qoreseal";
import { api, ApiError } from "./api";
import { CHAIN_ID, signText } from "./qorex";
import { forgetSeed, recallSeed, rememberSeed, touchSeed } from "./tabkey";

const vaultKey = (address: string) => `cista.vault.${address}`;
const unlocked = new Map<string, SealKeyPair>();

export function savedVault(address: string): Vault | null {
  try {
    return JSON.parse(localStorage.getItem(vaultKey(address)) ?? "null");
  } catch {
    return null;
  }
}

function saveVault(v: Vault) {
  try {
    localStorage.setItem(vaultKey(v.address), JSON.stringify(v));
  } catch {
    /* the backup file still holds it */
  }
}

function announce() {
  window.dispatchEvent(new Event("cista:keys"));
}

async function useSeed(address: string, seed: Uint8Array): Promise<SealKeyPair> {
  const keys = sealKeysFromSeed(seed);
  unlocked.set(address, keys);
  await rememberSeed(address, seed);
  seed.fill(0);
  announce();
  return keys;
}

/** The unlocked keys, if this page has them. */
export function unlockedKeys(address: string): SealKeyPair | undefined {
  if (unlocked.has(address)) touchSeed(address);
  return unlocked.get(address);
}

/** After a reload: picks the key back up if this tab unlocked it recently. */
export async function restoreKeys(address: string): Promise<SealKeyPair | undefined> {
  if (unlocked.has(address)) return unlocked.get(address);
  const seed = await recallSeed(address);
  return seed ? useSeed(address, seed) : undefined;
}

export function lockKeys(address: string) {
  unlocked.delete(address);
  forgetSeed(address);
  announce();
}

/** A new key: returns the recovery phrase to show once, and the locked vault. */
export async function createKeys(address: string, password: string): Promise<{ phrase: string; vault: Vault }> {
  const phrase = newRecoveryPhrase();
  const seed = seedFromPhrase(phrase);
  const vault = await lockSeed(seed, password, address);
  saveVault(vault);
  await useSeed(address, seed);
  return { phrase, vault };
}

export async function unlockKeys(address: string, password: string, vault = savedVault(address)): Promise<SealKeyPair> {
  if (!vault) throw new Error("no Cista key in this browser for this account");
  const seed = await unlockSeed(vault, password, address);
  // A vault from before Argon2id: lock it again with Argon2id under the same password.
  saveVault(needsUpgrade(vault) ? await lockSeed(seed, password, address) : vault);
  return useSeed(address, seed);
}

/** Forgot the password: the recovery phrase rebuilds the key under a new password. */
export async function recoverKeys(address: string, phrase: string, newPassword: string): Promise<{ keys: SealKeyPair; matchesCard: boolean | null }> {
  const seed = seedFromPhrase(phrase);
  const keys = sealKeysFromSeed(seed);
  let matchesCard: boolean | null = null;
  try {
    const entry = await api.card(address);
    matchesCard = entry.mlkemPublicKey === toHex(keys.mlkemPublicKey);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  const vault = await lockSeed(seed, newPassword, address);
  saveVault(vault);
  await useSeed(address, seed);
  return { keys, matchesCard };
}

export function downloadVault(vault: Vault) {
  const blob = new Blob([JSON.stringify(vault, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cista-key-${vault.address.slice(0, 12)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Is this browser's key the one published in the account's key card? */
export async function cardPublished(address: string, keys: SealKeyPair): Promise<boolean> {
  try {
    const entry = await api.card(address);
    return entry.mlkemPublicKey === toHex(keys.mlkemPublicKey) && entry.card.x25519PublicKey === toHex(keys.x25519PublicKey);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

/** Signs the key card in QoreX and publishes it, with the ML-KEM key, on the Cista server. */
export async function publishCard(address: string, keys: SealKeyPair): Promise<RecipientCard> {
  const fields = recipientCardFields({ chainId: CHAIN_ID, address, keys });
  const signature = await signText(address, recipientCardText(fields));
  const card = assembleRecipientCard(fields, signature);
  await api.putCard(card, toHex(keys.mlkemPublicKey));
  return card;
}
