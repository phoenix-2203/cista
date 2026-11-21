import { describe, expect, it } from "vitest";
import { toHex } from "../src/bytes";
import { ARGON2, lockSeed, needsUpgrade, unlockSeed, VaultError, type Vault } from "../src/vault";

const seed = crypto.getRandomValues(new Uint8Array(32));
// Lighter settings keep most tests fast; one test runs the app's own settings.
const FAST = { kdf: "argon2id", m: 19_456, t: 1, p: 1 } as const;
const OLD = { kdf: "pbkdf2-sha256", rounds: 100_000 } as const;

describe("key vault", () => {
  it("locks new vaults with Argon2id at 64 MiB, 3 passes, and round-trips", async () => {
    const v = await lockSeed(seed, "correct horse battery", "qor1ada");
    expect(v).toMatchObject({ kdf: "argon2id", m: ARGON2.m, t: ARGON2.t, p: ARGON2.p });
    expect(needsUpgrade(v)).toBe(false);
    expect(await unlockSeed(v, "correct horse battery", "qor1ada")).toEqual(seed);
    expect(JSON.stringify(v)).not.toContain(toHex(seed));
  });

  it("still opens vaults made with PBKDF2, and flags them for an upgrade", async () => {
    const v = await lockSeed(seed, "correct horse battery", "qor1ada", OLD);
    expect(v.kdf).toBe("pbkdf2-sha256");
    expect(needsUpgrade(v)).toBe(true);
    expect(await unlockSeed(v, "correct horse battery", "qor1ada")).toEqual(seed);
  });

  it("refuses a wrong password", async () => {
    for (const kdf of [FAST, OLD]) {
      const v = await lockSeed(seed, "correct horse battery", "qor1ada", kdf);
      await expect(unlockSeed(v, "wrong horse battery", "qor1ada")).rejects.toThrow(VaultError);
    }
  });

  it("refuses another account's backup, even with its address field edited", async () => {
    const v = await lockSeed(seed, "correct horse battery", "qor1ada", FAST);
    await expect(unlockSeed(v, "correct horse battery", "qor1bayo")).rejects.toThrow(/belongs to/);
    await expect(unlockSeed({ ...v, address: "qor1bayo" }, "correct horse battery", "qor1bayo")).rejects.toThrow(/wrong password/);
  });

  it("refuses short passwords, tampered boxes and settings out of range", async () => {
    await expect(lockSeed(seed, "short", "qor1ada", FAST)).rejects.toThrow(VaultError);
    const v = await lockSeed(seed, "correct horse battery", "qor1ada", FAST);
    const flipped = v.box.slice(0, -2) + (v.box.endsWith("00") ? "01" : "00");
    await expect(unlockSeed({ ...v, box: flipped }, "correct horse battery", "qor1ada")).rejects.toThrow(VaultError);
    // A backup edited to ask for absurd memory or passes is refused before any work.
    await expect(unlockSeed({ ...v, m: 64 * 1_048_576 } as Vault, "correct horse battery", "qor1ada")).rejects.toThrow(/damaged/);
    await expect(unlockSeed({ ...v, m: 8 } as Vault, "correct horse battery", "qor1ada")).rejects.toThrow(/damaged/);
    await expect(unlockSeed({ ...v, kdf: "scrypt" } as unknown as Vault, "correct horse battery", "qor1ada")).rejects.toThrow(/not a Cista key backup/);
  });
});
