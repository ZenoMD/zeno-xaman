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

## License

Unlicensed
