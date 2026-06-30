import { Xumm } from "xumm";
import { XUMM_API_KEY } from "./xumm-api-key.js";

// A single shared Xumm instance for the whole app: the sign-in flow (wallet.js)
// and the XRPL balance queries (xrpl.js) must talk to the same connected
// account, and constructing more than one SDK inside the xApp races the OTT
// handshake. Lazily created so it is only instantiated in the browser.
let instance;

export function getXumm() {
  if (!instance) instance = new Xumm(XUMM_API_KEY);
  return instance;
}
