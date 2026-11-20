import { describe, expect, it } from "vitest";
import { toHex } from "../src/bytes";
import { lockSeed, unlockSeed, VaultError } from "../src/vault";

const seed = crypto.getRandomValues(new Uint8Array(32));
const ROUNDS = 100_000; // fewer rounds keep the tests fast; the app uses 600,000

describe("key vault", () => {
  it("round-trips the seed with the right password", async () => {
    const v = await lockSeed(seed, "correct horse battery", "qor1ada", ROUNDS);
    expect(await unlockSeed(v, "correct horse battery", "qor1ada")).toEqual(seed);
    expect(JSON.stringify(v)).not.toContain(toHex(seed));
  });

  it("refuses a wrong password", async () => {
    const v = await lockSeed(seed, "correct horse battery", "qor1ada", ROUNDS);
    await expect(unlockSeed(v, "wrong horse battery", "qor1ada")).rejects.toThrow(VaultError);
  });

  it("refuses another account's backup, even with its address field edited", async () => {
    const v = await lockSeed(seed, "correct horse battery", "qor1ada", ROUNDS);
    await expect(unlockSeed(v, "correct horse battery", "qor1bayo")).rejects.toThrow(/belongs to/);
    await expect(unlockSeed({ ...v, address: "qor1bayo" }, "correct horse battery", "qor1bayo")).rejects.toThrow(/wrong password/);
  });

  it("refuses short passwords and tampered boxes", async () => {
    await expect(lockSeed(seed, "short", "qor1ada", ROUNDS)).rejects.toThrow(VaultError);
    const v = await lockSeed(seed, "correct horse battery", "qor1ada", ROUNDS);
    const flipped = v.box.slice(0, -2) + (v.box.endsWith("00") ? "01" : "00");
    await expect(unlockSeed({ ...v, box: flipped }, "correct horse battery", "qor1ada")).rejects.toThrow(VaultError);
  });
});
