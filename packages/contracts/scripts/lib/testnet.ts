/**
 * The throwaway testnet account the deploy script uses, from the git-ignored
 * .env.seed (the same file and account as Unyoke's testnet scripts). It
 * refuses anything that looks like a real wallet: more than 50 QOR, or no
 * registered post-quantum key. Your QoreX wallet's phrase is never needed.
 */
import { evmWindowCost, qorechainTestnet } from "@qorechain/evm";
import { EthNativeSigner, deriveUnifiedAccount, openEvmWindowMsg } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CHAIN_ID = "qorechain-diana";
export const REST = "https://api-testnet.qore.host";
export const NATIVE_FEE = { amount: [{ denom: "uqor", amount: "90000" }], gas: "600000" };
export const MAX_FEE_PER_GAS = 250_000_000_000n;

export async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${REST}${path}`, init);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

interface Included {
  code: number;
  transactionHash: string;
  rawLog?: string;
}

const transport = {
  async broadcastTx(tx: Uint8Array): Promise<Included> {
    const res = await rest<{ tx_response: { code: number; txhash: string; raw_log: string } }>("/cosmos/tx/v1beta1/txs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: Buffer.from(tx).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
    });
    const { code, txhash, raw_log } = res.tx_response;
    if (code !== 0) return { code, transactionHash: txhash, rawLog: raw_log };
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${txhash}`);
      if (got.ok) {
        const j = (await got.json()) as { tx_response: { code: number; raw_log: string } };
        return { code: j.tx_response.code, transactionHash: txhash, rawLog: j.tx_response.raw_log };
      }
    }
    throw new Error(`Not included after 45 s: ${txhash}`);
  },
};

export async function loadTestAccount() {
  const mnemonic = (process.env.E2E_MNEMONIC ?? process.env.SEED_MNEMONIC)?.trim();
  if (!mnemonic) {
    throw new Error("Put a THROWAWAY testnet phrase in packages/contracts/.env.seed as E2E_MNEMONIC=\"…\" (copy Unyoke's .env.seed).");
  }
  const acc = await deriveUnifiedAccount(mnemonic);
  const bal = await rest<{ balance: { amount: string } }>(`/cosmos/bank/v1beta1/balances/${acc.cosmos}/by_denom?denom=uqor`);
  const uqor = BigInt(bal.balance?.amount ?? "0");
  if (uqor > 50_000_000n) throw new Error("This account holds more than 50 QOR. Use a throwaway testnet account.");
  if (uqor < 500_000n) throw new Error(`Fund ${acc.cosmos} with at least 0.5 test QOR first (https://dashboard.qorechain.io/faucet).`);
  const pqc = await rest<{ found: boolean }>(`/qorechain/pqc/v1/account/${acc.cosmos}`);
  if (!pqc.found) throw new Error("This account has no post-quantum key registered. Use the account from Unyoke's .env.seed.");
  const signer = new EthNativeSigner(acc, { signMode: "hybrid", rest: REST });

  async function native(label: string, messages: { typeUrl: string; value: unknown }[]) {
    const a = await rest<{ account: { account_number: string; sequence: string } }>(`/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
    const res = (await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber: BigInt(a.account.account_number),
      sequence: BigInt(a.account.sequence),
      fee: NATIVE_FEE,
      messages: messages as never,
      memo: `cista script: ${label}`,
    })) as Included;
    if (res.code !== 0) throw new Error(`${label} failed (code ${res.code}): ${res.rawLog}`);
    return res.transactionHash;
  }

  /** An EVM window, hybrid-signed. Empty targets: contract creation is allowed (a scoped window refuses it). */
  async function openWindow(targets: string[], maxTxs: number, gasPerTx: bigint) {
    const maxValue = evmWindowCost({ gas: gasPerTx, maxFeePerGas: MAX_FEE_PER_GAS }) * BigInt(maxTxs);
    return native("open window", [openEvmWindowMsg({ sender: acc.cosmos, blocks: 100, maxTxs, maxValue: maxValue.toString(), allowedTargets: targets })]);
  }

  const wallet = createWalletClient({ account: privateKeyToAccount(acc.privateKey as `0x${string}`), chain: qorechainTestnet, transport: http() });
  const pub = createPublicClient({ chain: qorechainTestnet, transport: http() });
  return { qor: acc.cosmos, evm: acc.evm as `0x${string}`, openWindow, wallet, pub };
}
