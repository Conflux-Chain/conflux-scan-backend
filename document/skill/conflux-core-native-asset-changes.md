---
name: conflux-core-native-asset-changes
description: Explain special CFX balance changes in Conflux Core Space.
---

# Core Space Native Asset Changes

Use `GET /account/transfers`. Do not use the normal transaction list as a complete balance history.

| `transferType` | Meaning |
|---|---|
| `call` | CFX moved during a contract call |
| `create` | CFX moved during contract creation |
| `gas_payment` | Gas payment |
| `storage_collateral` | Storage collateral change |
| `sponsor_balance_for_gas` | Sponsored-gas fund change |
| `sponsor_balance_for_collateral` | Sponsored-collateral fund change |
| `staking_balance` | Staked CFX change |
| `balance` | Other native balance change |

## Rules

- A CFX decrease is not always a transfer.
- Do not classify storage collateral as gas.
- Do not classify sponsor funds as ordinary user transfers.
- Use `from` and `to` to infer direction; do not infer it from `transferType` alone.
- Amounts are raw integer strings. Apply decimals before display.
- Follow the returned `data.next` cursor for more records.
