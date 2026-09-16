# Zeno Xaman Contracts

A router that adapts the [Axelar ITS Executable service](https://docs.axelar.dev/dev/send-tokens/interchain-tokens/interchain-token-executable/) to route deposits into a RAILGUN pool

## Deployment

Use the provided `just` scripts

```shell
PRIVATE_KEY=0x... just deploy
```

## Whitelist

By default XRPL addresses must be explicitly whitelisted before they can deposit into the pool. Add new addresses with

```shell
ROUTER_ADDRESS=0x... PRIVATE_KEY=0x... just whitelist r...
```

## License

[MIT](LICENSE). Note this differs from the license covering the rest of the repo.
