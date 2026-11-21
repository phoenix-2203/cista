/**
 * A local EVM (ethereumjs) with CistaVerifier deployed and the two PQC
 * precompiles stood in by mocks at their real addresses.
 */
import { createEVM, type EVM } from "@ethereumjs/evm";
import { createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { readFileSync } from "node:fs";
import { decodeFunctionResult, encodeFunctionData, type Abi, type Hex } from "viem";

const artifacts = JSON.parse(readFileSync(new URL("./artifacts.json", import.meta.url), "utf8")) as Record<string, { abi: Abi; deployed: Hex }>;
export const VERIFIER_ABI = artifacts.CistaVerifier!.abi;

const VERIFIER = createAddressFromString("0x00000000000000000000000000000000000c15a0");
const PQC_VERIFY = createAddressFromString("0x0000000000000000000000000000000000000a01");
const PQC_KEY_STATUS = createAddressFromString("0x0000000000000000000000000000000000000a02");
const CALLER = createAddressFromString("0x1000000000000000000000000000000000000001");

export class RevertError extends Error {
  constructor(readonly data: Hex) {
    super(`reverted ${data}`);
  }
}

export class TestChain {
  private constructor(private readonly evm: EVM) {}

  static async create(): Promise<TestChain> {
    const evm = await createEVM();
    await evm.stateManager.putCode(VERIFIER, hexToBytes(artifacts.CistaVerifier!.deployed));
    await evm.stateManager.putCode(PQC_VERIFY, hexToBytes(artifacts.MockPqcVerify!.deployed));
    await evm.stateManager.putCode(PQC_KEY_STATUS, hexToBytes(artifacts.MockPqcKeyStatus!.deployed));
    return new TestChain(evm);
  }

  private async raw(to: typeof VERIFIER, data: Hex) {
    const r = await this.evm.runCall({ to, caller: CALLER, data: hexToBytes(data), gasLimit: 30_000_000n });
    const ret = `0x${Buffer.from(r.execResult.returnValue).toString("hex")}` as Hex;
    if (r.execResult.exceptionError) throw new RevertError(ret);
    return { ret, gas: r.execResult.executionGasUsed };
  }

  /** Calls a CistaVerifier function; throws RevertError on revert. */
  async call<T = unknown>(functionName: string, args: unknown[]): Promise<{ result: T; gas: bigint }> {
    const data = encodeFunctionData({ abi: VERIFIER_ABI, functionName, args } as never);
    const { ret, gas } = await this.raw(VERIFIER, data);
    return { result: decodeFunctionResult({ abi: VERIFIER_ABI, functionName, data: ret } as never) as T, gas };
  }

  /** Runs raw calldata against CistaVerifier (as a caller outside the tests built it). */
  async callRaw(data: Hex) {
    return this.raw(VERIFIER, data);
  }

  async registerKey(account: Hex, pubkey: Uint8Array) {
    await this.raw(PQC_KEY_STATUS, encodeFunctionData({ abi: artifacts.MockPqcKeyStatus!.abi, functionName: "set", args: [account, toHex(pubkey)] } as never));
  }

  async allowSignature(pubkey: Uint8Array, signature: Uint8Array, message: Uint8Array) {
    await this.raw(PQC_VERIFY, encodeFunctionData({ abi: artifacts.MockPqcVerify!.abi, functionName: "allow", args: [toHex(pubkey), toHex(signature), toHex(message)] } as never));
  }

  /** Removes a precompile, as on a network where it isn't active. */
  async dropPrecompiles() {
    await this.evm.stateManager.putCode(PQC_VERIFY, new Uint8Array());
    await this.evm.stateManager.putCode(PQC_KEY_STATUS, new Uint8Array());
  }
}

export const toHex = (b: Uint8Array): Hex => `0x${Buffer.from(b).toString("hex")}`;
