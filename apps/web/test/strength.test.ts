import { describe, expect, it } from "vitest";
import { estimate, MIN_SCORE } from "../src/lib/strength";

describe("password strength", () => {
  it("rates common passwords and their dressed-up forms very weak", () => {
    for (const pw of ["password", "Password123!", "qwertyuiop", "1234567890", "Cista2026!!"]) {
      expect(estimate(pw).score, pw).toBeLessThan(MIN_SCORE);
    }
  });

  it("sees through repeats and keyboard runs", () => {
    expect(estimate("aaaaaaaaaaaaaaaa").score).toBe(0);
    expect(estimate("abcdefghijklmnop").score).toBe(0);
    expect(estimate("1qaz2wsx3edc").score).toBeLessThan(MIN_SCORE + 2);
  });

  it("rates a long mixed password and a four-word phrase strong", () => {
    expect(estimate("vT9#qLm2!xR7&zKp").score).toBe(4);
    expect(estimate("lantern orbit velvet cashew").score).toBeGreaterThanOrEqual(3);
  });

  it("marks down a password built on the account address", () => {
    const address = "qor1qef7x5ac8zwq82ckeyg80j9g3ekdpgwczw8lwh";
    expect(estimate(`${address.slice(0, 12)}x`, [address.slice(0, 12)]).score).toBeLessThan(MIN_SCORE);
  });

  it("explains what to change", () => {
    expect(estimate("short").hint).toMatch(/10 characters/);
    expect(estimate("password").hint).toMatch(/first passwords/);
    expect(estimate("")).toEqual({ score: 0, label: "", hint: "" });
  });
});
