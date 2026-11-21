/** Formatting helpers with no dependencies, so the landing page can use them without the crypto. */

export function short(address: string): string {
  return address.length > 20 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;
}

/** Kobo (or any minor unit) to a grouped amount with 2 decimals. */
export function money(minor: bigint | string, currency = "NGN"): string {
  const v = typeof minor === "string" ? BigInt(minor) : minor;
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "NGN" ? "₦" : currency === "USD" ? "$" : `${currency} `;
  return `${sign}${symbol}${whole}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Base units of a token to a grouped amount, trailing zeros trimmed. */
export function units(amount: bigint | string, decimals: number, symbol: string): string {
  const v = typeof amount === "string" ? BigInt(amount) : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = (v / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (v % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} ${symbol}`;
}

const TOKENS: Record<string, { decimals: number; symbol: string }> = {
  uqor: { decimals: 6, symbol: "QOR" },
  "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA": { decimals: 6, symbol: "fUSD" },
};

/** A payout in its token: "2,790.5 fUSD", "2.685 QOR". */
export function payout(amount: bigint | string, denom: string): string {
  const t = TOKENS[denom];
  return t ? units(amount, t.decimals, t.symbol) : `${amount} ${denom}`;
}

/** uqor to QOR, trimmed. */
export function qor(uqor: bigint | string): string {
  const v = typeof uqor === "string" ? BigInt(uqor) : uqor;
  const whole = (v / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} QOR`;
}
