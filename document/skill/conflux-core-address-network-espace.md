---
name: conflux-core-address-network-espace
description: Identify Conflux Core Space addresses, networks, and eSpace mappings.
---

# Core Address, Network, and eSpace

| Address prefix | Network | API host |
|---|---|---|
| `cfx:` | Core mainnet | `https://api.confluxscan.org` |
| `cfxtest:` | Core testnet | `https://api-testnet.confluxscan.org` |
| `0x` | Usually eSpace/EVM | Do not send directly to the Core API |

To find an associated eSpace address, call:

`GET /account/infos?accounts=<Core-address>&withESpaceInfo=true`

Read the result from `eSpace.address`.

## Rules

- Match `cfx:` with the Core mainnet API.
- Match `cfxtest:` with the Core testnet API.
- Never convert an address by replacing `cfx:` or `cfxtest:` with `0x`.
- If `eSpace.address` is absent, report that no mapping was returned.
- A mapped address does not imply identical state or assets in both spaces.
