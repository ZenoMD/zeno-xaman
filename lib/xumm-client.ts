import { Xumm } from "xumm";

// A single shared Xumm instance for the whole app: the sign-in flow (wallet.ts)
// and the XRPL balance queries (xrpl.ts) must talk to the same connected
// account, and constructing more than one SDK inside the xApp races the OTT
// handshake. Lazily created so it is only instantiated in the browser.
let instance: Xumm | undefined;

export function getXumm(): Xumm {
  const key = process.env.NEXT_PUBLIC_XUMM_API_KEY;

  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_XUMM_API_KEY is not set — add it to .env.local for local dev " +
        "(copy .env.local.example) or to your CI environment for deploys.",
    );
  }

  if (!instance) instance = new Xumm(key);
  return instance;
}
