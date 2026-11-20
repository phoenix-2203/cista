/**
 * The QoreX browser extension (`window.qorex.native`).
 *
 * Cista uses three things from it:
 * - `getKey`: the account's `qor1` address.
 * - `signArbitrary`: a hybrid secp256k1 + ML-DSA-87 signature over readable
 *   text (sign-in, the pay run, a proof of pay, the recipient card). Checked
 *   in the user's QoreX: the capability is declared.
 * - `signAndBroadcast`: QoreX shows the messages, adds the hybrid signature
 *   and broadcasts (registering the sealing key, paying the team).
 *
 * The published type package still says signArbitrary is refused, so the
 * shapes are declared here, as they come back from the extension.
 */
import type { EncodedMessage, MessageSignature } from "@phoenix-2203/cista";

export const CHAIN_ID = "qorechain-diana";
export const QOREX_INSTALL_URL = "https://chromewebstore.google.com/detail/qorex/cflpnggbnnifibblifgbeobogdpfjpcg";

interface QorexKey {
  algo: string;
  bech32Address: string;
}

interface QorexNative {
  capabilities?: readonly string[];
  enable(chainId: string): Promise<unknown>;
  getKey(chainId: string): Promise<QorexKey>;
  signArbitrary(chainId: string, signer: string, data: string): Promise<MessageSignature & Record<string, unknown>>;
  signAndBroadcast(request: {
    chainId: string;
    messages: { typeUrl: string; value: number[] }[];
    memo?: string;
    gasLimit?: number;
  }): Promise<{ txHash: string; code: number; height?: number; shield?: string }>;
}

declare global {
  interface Window {
    qorex?: { native?: QorexNative };
  }
}

export class WalletError extends Error {
  constructor(
    readonly kind: "missing" | "unsupported" | "rejected" | "wrong-network" | "cannot-show" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

function native(): QorexNative {
  const q = window.qorex?.native;
  if (!q) throw new WalletError("missing", "QoreX isn't installed in this browser, or it is locked.");
  return q;
}

function can(q: QorexNative, cap: string): boolean {
  return q.capabilities?.includes(cap) ?? false;
}

function asWalletError(e: unknown): WalletError {
  if (e instanceof WalletError) return e;
  const m = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(m)) return new WalletError("rejected", "You declined in QoreX.");
  if (/cannot show|cannot display|will not sign|not supported/i.test(m)) {
    return new WalletError("cannot-show", `QoreX won't sign this yet: ${m}`);
  }
  if (/chain id|chainid|network|unsupported chain/i.test(m)) {
    return new WalletError(
      "wrong-network",
      `QoreX is on another network. Switch it to testnet: in the extension, tap the version number 7 times, then "Switch to testnet (diana)". (${m})`,
    );
  }
  return new WalletError("failed", m);
}

export function hasQorex(): boolean {
  return Boolean(window.qorex?.native);
}

/** Connects the site and returns the active account's address. */
export async function connect(): Promise<string> {
  const q = native();
  try {
    await q.enable(CHAIN_ID);
    const key = await q.getKey(CHAIN_ID);
    if (key.algo === "ethsecp256k1") {
      throw new WalletError("unsupported", "This QoreX account is an Ethereum-type account. Use a QoreChain (qor1) main account for Cista.");
    }
    return key.bech32Address;
  } catch (e) {
    throw asWalletError(e);
  }
}

/** A hybrid signature over readable text, approved by the user in QoreX. */
export async function signText(signer: string, text: string): Promise<MessageSignature> {
  const q = native();
  if (!can(q, "signArbitrary")) throw new WalletError("unsupported", "Update QoreX: this version cannot sign text yet.");
  try {
    const r = await q.signArbitrary(CHAIN_ID, signer, text);
    if (r.signatureType !== "ml-dsa-87-hybrid" || !r.pq) {
      throw new WalletError("failed", "QoreX returned a signature without the ML-DSA-87 part.");
    }
    return { signatureType: r.signatureType, classical: r.classical, pq: r.pq };
  } catch (e) {
    throw asWalletError(e);
  }
}

/** Sends messages through QoreX, which adds the hybrid signature. */
export async function sendMessages(messages: EncodedMessage[], opts: { memo?: string; gasLimit?: number } = {}) {
  const q = native();
  if (!can(q, "signAndBroadcast")) throw new WalletError("unsupported", "Update QoreX: this version cannot send transactions for websites yet.");
  try {
    const r = await q.signAndBroadcast({
      chainId: CHAIN_ID,
      messages: messages.map((m) => ({ typeUrl: m.typeUrl, value: Array.from(m.value) })),
      memo: opts.memo,
      gasLimit: opts.gasLimit,
    });
    if (r.code !== 0) throw new WalletError("failed", `The chain refused the transaction (code ${r.code}).`);
    if (r.shield === "downgraded") throw new WalletError("failed", "The transaction went through without its ML-DSA-87 signature. Check QoreX before going on.");
    return r;
  } catch (e) {
    throw asWalletError(e);
  }
}
