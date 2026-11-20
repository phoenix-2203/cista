/**
 * The user's sealing keys in this browser.
 *
 * The seed is made here, saved only inside a password-encrypted vault
 * (localStorage and a backup file), and unlocked into memory for this page
 * only. The ML-KEM-1024 public key is registered on chain through QoreX; the
 * X25519 public key is published in a recipient card the user signs in QoreX.
 */
import { equalBytes, lockSeed, unlockSeed, type Vault } from "@phoenix-2203/cista";
import {
  assembleRecipientCard,
  buildRegisterKemKeyMessage,
  recipientCardFields,
  recipientCardText,
  sealKeysFromSeed,
  type RecipientCard,
  type SealKeyPair,
} from "@qorechain/qoreseal";
import { api, ApiError } from "./api";
import { kemKeyOf } from "./chain";
import { CHAIN_ID, sendMessages, signText } from "./qorex";

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

export interface KeyStatus {
  /** The ML-KEM key on chain is this browser's key. */
  registered: boolean;
  /** Some other ML-KEM key is registered (an older one, or from another device). */
  otherKeyOnChain: boolean;
  /** The server has a card for this key. */
  cardPublished: boolean;
}

export async function keyStatus(address: string, keys: SealKeyPair): Promise<KeyStatus> {
  const onChain = await kemKeyOf(address);
  const registered = onChain !== null && equalBytes(onChain, keys.mlkemPublicKey);
  let cardPublished = false;
  try {
    const card = await api.card(address);
    cardPublished = card.x25519PublicKey === Array.from(keys.x25519PublicKey, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  return { registered, otherKeyOnChain: onChain !== null && !registered, cardPublished };
}

/** Registers the ML-KEM-1024 key on chain (QoreX signs and sends it). */
export async function registerKemKey(address: string, keys: SealKeyPair) {
  const msg = buildRegisterKemKeyMessage({ sender: address, mlkemPublicKey: keys.mlkemPublicKey });
  return sendMessages([{ typeUrl: msg.typeUrl, value: msg.value }], { memo: "Cista: sealing key", gasLimit: 400_000 });
}

/** Signs the recipient card in QoreX and publishes it on the Cista server. */
export async function publishCard(address: string, keys: SealKeyPair): Promise<RecipientCard> {
  const fields = recipientCardFields({ chainId: CHAIN_ID, address, keys });
  const signature = await signText(address, recipientCardText(fields));
  const card = assembleRecipientCard(fields, signature);
  await api.putCard(card);
  return card;
}
