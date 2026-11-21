/** Links and addresses the landing page shows, without loading viem or the chain readers. */
import deployment from "@cista/contracts/deployments/testnet.json";

export const EXPLORER_TX = "https://explore.qore.network/tx/";
export const EXPLORER_ADDRESS = "https://explore.qore.network/address/";
/** CistaVerifier on the testnet (the deployment file stores it checksummed). */
export const VERIFIER_ADDRESS = deployment.CistaVerifier;
