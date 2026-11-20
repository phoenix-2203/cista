/**
 * The user's sealing keys in this browser.
 *
 * The seed is made here, saved only inside a password-encrypted vault
 * (localStorage and a backup file), and unlocked into memory for this page
 * only. Both public keys (ML-KEM-1024 and X25519) are published in a key
 * card that the user signs in QoreX with their registered ML-DSA-87 key, so
 * anyone can check the keys are really theirs. (QoreX keeps registering an
 * ML-KEM key in the chain's KEM registry for the wallet itself: a website
 * can't send MsgRegisterKEMKey.)
 */
import { lockSeed, toHex, unlockSeed, type Vault } from "@phoenix-2203/cista";
import {
  assembleRecipientCard,
  recipientCardFields,
  recipientCardText,
  sealKeysFromSeed,
  type RecipientCard,
  type SealKeyPair,
} from "@qorechain/qoreseal";
import { api, ApiError } from "./api";
import { CHAIN_ID, signText } from "./qorex";

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

export function unlockedKeys(address: string): SealKeyPair | undefined {
  return unlocked.get(address);
}

export function forgetKeys(address: string) {
  unlocked.delete(address);
}

/** New sealing keys, locked with a password. Returns the vault to back up. */
export async function createKeys(address: string, password: string): Promise<Vault> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const vault = await lockSeed(seed, password, address);
  saveVault(vault);
  unlocked.set(address, sealKeysFromSeed(seed));
  seed.fill(0);
  return vault;
}

export async function unlockKeys(address: string, password: string, vault = savedVault(address)): Promise<SealKeyPair> {
  if (!vault) throw new Error("no Cista key in this browser for this account");
  const seed = await unlockSeed(vault, password, address);
  const keys = sealKeysFromSeed(seed);
  seed.fill(0);
  saveVault(vault);
  unlocked.set(address, keys);
  return keys;
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
