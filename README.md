# Zeno Wallet

![Zeno logo](./logo.png)

[![Build and Deploy](https://github.com/ZenoMD/zeno-xaman/actions/workflows/deploy.yml/badge.svg)](https://github.com/ZenoMD/zeno-xaman/actions/workflows/deploy.yml)

Convenient and compliant private payments on XRPL

## About

Zeno is a xApp for Xaman wallet that allows unlocks private payments from your existing XRPL account. 

Simply open the xApp and then shield/transfer/unshield XRP and other tokens. 

The Zeno shielded pool is a permissioned domain and KYC is required for entry so users can be sure they are not interacting with bad actors. Access is currently via whitelist until a suitable KYC partner can be found. To apply please install Xaman and complete the online form

https://forms.gle/wQ8fKFYXetboBTp7A

## Architecture

Zeno uses the well established and trusted RAILGUN protocol (currently securing over $77 million) deployed to the XRPL EVM sidechain as the underlying shielded pool. Users do not require an EVM address thanks to a number of bridging and gas sponsoring tricks.

- Deposits go via the canonical Axelar bridge directly into the pool. EVM gas is paid by the Axelar relay
- Shielded transfers/withdrawals are relayed via our custom broadcasting service and the broadcasters are reimbursed for gas with shielded tokens. This also preserves privacy by ensuring transfers do not have the spenders public signature attached

The result is full account abstraction of the EVM chain and spend authorization directly tied to the XRPL wallet keys.

Zeno is also a [permissioned domain](https://xls.xrpl.org/xls/XLS-0080-permissioned-domains.html). It handles compliance in an XRPL native way requiring approved credentials before deposits into the pool are allowed.

## Local Development

Uses [Bun](https://bun.sh/)

```shell
bun install
bun run dev
```

To test it within the Xaman wallet you will need to use [cloudflare tunnels](https://developers.cloudflare.com/tunnel/) or similar to obtain a public URL

```shell
cloudflared tunnel --url http://localhost:3000
```

Attach the resulting URL to a xApp in the [Xaman developer console](https://apps.xaman.dev/) and test either on-device or using the xAppBuilder application.

### Contracts

See [README](./contracts/README.md)

## Running as a web app (browser/web3)

The app also runs as a normal web app in a browser tab, outside the Xaman xApp
WebView. It detects the environment at runtime (see `lib/runtime.ts`):

- **Xaman xApp** — the session is established automatically and the wallet boots
  immediately.
- **Browser** — the user is shown a "Sign in with Xaman" button that runs the
  [browser/web3](https://docs.xaman.dev/environments/browser-web3) OAuth2 flow
  (QR sign-in on desktop, deeplink redirect on mobile). A restored 24h session
  signs the user straight back in without a click.

Both paths use the same `NEXT_PUBLIC_XUMM_API_KEY`. For the browser flow to
work you must register the app's URL in the
[Xaman developer console](https://apps.xaman.dev/) under **Origin/Redirect URIs
(one per line)** on the application home page — add every origin you serve from,
e.g. `http://localhost:3000` for local dev and your production URL. The SDK uses
the current page URL as the OAuth return URL, so an unlisted origin is rejected.

## License

[AGPL-3.0](LICENSE), except the contracts in [contracts/](./contracts), which are [MIT](./contracts/LICENSE)
