// Which environment is the app running in?
//
// Xaman apps can run two ways (https://docs.xaman.dev/environments/browser-web3):
//   - inside the Xaman xApp WebView, where the session is established
//     automatically via the OTT handshake, or
//   - as a regular web app in a browser tab ("browser/web3" mode), where the
//     user must explicitly sign in with Xaman over OAuth2.
//
// This mirrors the xumm SDK's own user-agent check so we can branch *before*
// constructing the SDK — importantly without importing the `xumm` package,
// which touches `navigator` at module load and so must never be pulled into the
// static export's server bundle.
export function isXappRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /xumm\/xapp/i.test(ua) || /xAppBuilder/i.test(ua);
}
