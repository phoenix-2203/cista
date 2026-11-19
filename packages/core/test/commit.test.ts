import { describe, expect, it } from "vitest";
import { equalBytes, fromHex, toHex } from "../src/bytes";
import { commitFields, fieldCommitment, fieldSalt, randomSeed } from "../src/commit";
import { payslipFields } from "../src/payslip";
import { sampleSlip } from "./fixtures";

const SEED = fromHex("11".repeat(32));

describe("field commitments", () => {
  it("are fixed for a fixed seed (test vector)", () => {
    const c = fieldCommitment({ name: "net", value: "38210000" }, fieldSalt(SEED, "net"));
    // Pinned so the Solidity verifier and any other implementation can be checked against it.
    expect(toHex(c)).toMatchInlineSnapshot(`"cf8bc8fa5a41a404a30a38d77243cb3a40955a9706bf6d1cd00251c54300a9f6"`);
  });

  it("change when the value changes by one kobo", () => {
    const salt = fieldSalt(SEED, "net");
    const a = fieldCommitment({ name: "net", value: "38210000" }, salt);
    const b = fieldCommitment({ name: "net", value: "38210001" }, salt);
    expect(equalBytes(a, b)).toBe(false);
  });

  it("bind the field name, so a value cannot be moved to another field", () => {
    const salt = fieldSalt(SEED, "net");
    const a = fieldCommitment({ name: "net", value: "38210000" }, salt);
    const b = fieldCommitment({ name: "gross", value: "38210000" }, salt);
    expect(equalBytes(a, b)).toBe(false);
  });

  it("give every field its own salt", () => {
    expect(equalBytes(fieldSalt(SEED, "net"), fieldSalt(SEED, "gross"))).toBe(false);
  });

  it("hide the value: two seeds give unrelated commitments", () => {
    const f = { name: "net", value: "38210000" };
    const a = fieldCommitment(f, fieldSalt(randomSeed(), f.name));
    const b = fieldCommitment(f, fieldSalt(randomSeed(), f.name));
    expect(equalBytes(a, b)).toBe(false);
  });

  it("refuse short seeds and salts", () => {
    expect(() => fieldSalt(new Uint8Array(16), "net")).toThrow();
    expect(() => fieldCommitment({ name: "net", value: "1" }, new Uint8Array(31))).toThrow();
  });

  it("commit every payslip field", () => {
    const fields = payslipFields(sampleSlip());
    const commitments = commitFields(fields, SEED);
    expect(commitments).toHaveLength(fields.length);
    expect(new Set(commitments.map(toHex)).size).toBe(fields.length);
  });
});
