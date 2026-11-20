/**
 * The payment messages of a pay run, protobuf-encoded the way QoreX's
 * `signAndBroadcast` takes them (type URL + bytes). Only two messages are
 * needed, so they are encoded here by hand rather than pulling in a full
 * Cosmos SDK registry; test vectors pin the bytes.
 *
 *   MsgSend      { from_address = 1; to_address = 2; repeated Coin amount = 3 }
 *   MsgMultiSend { repeated Input inputs = 1; repeated Output outputs = 2 }
 *   Input/Output { address = 1; repeated Coin coins = 2 }
 *   Coin         { denom = 1; amount = 2 }        (amount is a decimal string)
 */
import { concat, utf8 } from "./bytes";
import type { PayRun } from "./run";

export const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
export const MSG_MULTI_SEND = "/cosmos.bank.v1beta1.MsgMultiSend";
/** QoreX takes at most 32 messages per transaction. */
export const MAX_SENDS_PER_TX = 32;

export interface EncodedMessage {
  typeUrl: string;
  value: Uint8Array;
}

export interface Payout {
  to: string;
  amount: bigint;
}

function varint(n: number): Uint8Array {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return new Uint8Array(out);
}

/** A length-delimited field (wire type 2). */
function field(no: number, bytes: Uint8Array): Uint8Array {
  return concat(varint((no << 3) | 2), varint(bytes.length), bytes);
}

const str = (no: number, s: string) => field(no, utf8(s));
const coin = (denom: string, amount: bigint) => concat(str(1, denom), str(2, amount.toString()));

export function encodeMsgSend(from: string, to: string, denom: string, amount: bigint): Uint8Array {
  return concat(str(1, from), str(2, to), field(3, coin(denom, amount)));
}

export function encodeMsgMultiSend(from: string, denom: string, payouts: Payout[]): Uint8Array {
  const total = payouts.reduce((s, p) => s + p.amount, 0n);
  const input = concat(str(1, from), field(2, coin(denom, total)));
  return concat(field(1, input), ...payouts.map((p) => field(2, concat(str(1, p.to), field(2, coin(denom, p.amount))))));
}

export function runPayouts(run: PayRun): Payout[] {
  return run.slips.map((s) => ({ to: s.slip.payout.address, amount: s.slip.payout.amount }));
}

/** One MsgMultiSend paying the whole run. */
export function multiSendMessages(run: PayRun): EncodedMessage[] {
  return [{ typeUrl: MSG_MULTI_SEND, value: encodeMsgMultiSend(run.employer, run.denom, runPayouts(run)) }];
}

/** One MsgSend per payslip, for wallets that cannot show a MsgMultiSend. */
export function sendMessages(run: PayRun): EncodedMessage[] {
  if (run.slips.length > MAX_SENDS_PER_TX) {
    throw new Error(`a run of more than ${MAX_SENDS_PER_TX} payslips must be paid with one multi-send`);
  }
  return runPayouts(run).map((p) => ({ typeUrl: MSG_SEND, value: encodeMsgSend(run.employer, p.to, run.denom, p.amount) }));
}

/** A gas hint for QoreX, which clamps it to 100,000 to 5,000,000. */
export function payRunGas(payslips: number): number {
  return Math.min(5_000_000, 150_000 + 40_000 * payslips);
}
