import { describe, expect, it } from "vitest";
import { encodeMsgMultiSend, encodeMsgSend, MAX_SENDS_PER_TX, multiSendMessages, payRunGas, sendMessages } from "../src/bankmsg";
import { toHex, fromHex } from "../src/bytes";
import { buildPayRun } from "../src/run";
import { ADDR, sampleSlip } from "./fixtures";

// Expected bytes made with @qorechain/sdk's protobuf registry (cosmjs), outside this code.
const SEND =
  "0a2a716f72316c686e333935356737396a666d757a76716d637a336d7379723537717837386579766c616e68122a716f72316b336c707a666574756630396537643835727363386d727378656735336d7a757a376e716a331a110a0475716f721209333832313030303030";
const MULTI =
  "0a3f0a2a716f72316c686e333935356737396a666d757a76716d637a336d7379723537717837386579766c616e6812110a0475716f721209363332313030303030123f0a2a716f72316b336c707a666574756630396537643835727363386d727378656735336d7a757a376e716a3312110a0475716f721209333832313030303030123f0a2a716f72316736356e687964736c703239636c3774717a683676723567686674333478346d7366786e766312110a0475716f721209323530303030303030";

describe("bank messages", () => {
  it("encode MsgSend exactly as the SDK does", () => {
    expect(toHex(encodeMsgSend(ADDR.employer, ADDR.ada, "uqor", 382_100_000n))).toBe(SEND);
  });

  it("encode MsgMultiSend exactly as the SDK does, with the total as the one input", () => {
    const bytes = encodeMsgMultiSend(ADDR.employer, "uqor", [
      { to: ADDR.ada, amount: 382_100_000n },
      { to: ADDR.bayo, amount: 250_000_000n },
    ]);
    expect(toHex(bytes)).toBe(MULTI);
  });

  it("pay a built run with one multi-send, or one send per payslip", () => {
    const ada = sampleSlip();
    const bayo = sampleSlip({
      employee: { ...ada.employee, address: ADDR.bayo, name: "Bayo" },
      payout: { address: ADDR.bayo, denom: "uqor", amount: 250_000_000n },
    });
    const run = buildPayRun("qorechain-diana", [
      { slip: ada, seed: fromHex("01".repeat(32)) },
      { slip: bayo, seed: fromHex("02".repeat(32)) },
    ]);
    const multi = multiSendMessages(run);
    expect(multi).toHaveLength(1);
    expect(multi[0]!.typeUrl).toBe("/cosmos.bank.v1beta1.MsgMultiSend");
    const sends = sendMessages(run);
    expect(sends.map((m) => m.typeUrl)).toEqual(["/cosmos.bank.v1beta1.MsgSend", "/cosmos.bank.v1beta1.MsgSend"]);
    expect(toHex(sends[1]!.value)).toBe(toHex(encodeMsgSend(ADDR.employer, ADDR.bayo, "uqor", 250_000_000n)));
  });

  it("keep the gas hint inside QoreX's range", () => {
    expect(payRunGas(1)).toBe(190_000);
    expect(payRunGas(10_000)).toBe(5_000_000);
    expect(MAX_SENDS_PER_TX).toBe(32);
  });
});
