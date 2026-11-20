import { addressFromPublicKey, classicalKeyFromPrivate, pqKeyFromSeed, signMessage, type MessageSignature } from "@qorechain/qoresign";

/** A throwaway in-memory account for tests: random keys, never on chain. */
export function testAccount() {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const classicalKey = classicalKeyFromPrivate(secret, "secp256k1");
  const pqKey = pqKeyFromSeed(seed);
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  return {
    address,
    pqPublicKey: pqKey.publicKey,
    sign(chainId: string, text: string, opts: { pq?: boolean } = {}): MessageSignature {
      return signMessage({ chainId, signer: address, data: text, classicalKey, pqKey: opts.pq === false ? undefined : pqKey });
    },
  };
}
