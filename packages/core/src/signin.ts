/**
 * Signing in to the Cista server: the account signs a short statement in
 * QoreX (`signArbitrary`, hybrid ML-DSA-87) with a one-time nonce the server
 * issued. The server checks it against the account's registered key, so a
 * stolen classical key alone cannot sign in.
 */
export interface SignIn {
  domain: string;
  address: string;
  chainId: string;
  nonce: string;
  /** ISO 8601 */
  issuedAt: string;
}

export function signInStatement(s: SignIn): string {
  if (!/^[A-Za-z0-9]{16,64}$/.test(s.nonce)) throw new Error("nonce must be 16 to 64 letters and digits");
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(s.domain)) throw new Error("domain is not valid");
  if (Number.isNaN(Date.parse(s.issuedAt))) throw new Error("issuedAt must be a date and time");
  return [
    "Sign in to Cista",
    `Domain: ${s.domain}`,
    `Account: ${s.address}`,
    `Chain: ${s.chainId}`,
    `Nonce: ${s.nonce}`,
    `Issued: ${new Date(s.issuedAt).toISOString()}`,
  ].join("\n");
}
