import { Xumm } from "xumm";
import { XUMM_API_KEY } from "./xumm-api-key";

// A single shared Xumm instance for the whole app: the sign-in flow (wallet.ts)
// and the XRPL balance queries (xrpl.ts) must talk to the same connected
// account, and constructing more than one SDK inside the xApp races the OTT
// handshake. Lazily created so it is only instantiated in the browser.
let instance: Xumm | undefined;

export function getXumm(): Xumm {
  if (!instance) instance = new Xumm(XUMM_API_KEY);
  return instance;
}
