# Zeno XAMAN

A [XAMAN](https://xumm.app/?lang=en) xApp demonstrating shielded pool support.

This is currently a WIP spike but it has aspirations to be a fully functional RAILGUN compatible shielded wallet that can run within the XAMAN XRPL wallet

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

Unlicensed
