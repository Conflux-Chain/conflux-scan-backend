# Epoch data checker design

## Purpose

The checker replays the production containers' epoch data logic in memory from
RPC results and validates the read-only database. It never writes production
data. A KV cursor is kept for each direction:

- `forward` starts at `latest_finalized - 100000` on first use and increases.
- `backward` starts at the same point and decreases toward epoch zero.
- The cursors are independent and do not stop when they meet.

The worker uses a database lease, so only one host can run it. Cursors and the
lease survive process restarts. A mismatch pauses that direction and sends a
DingTalk alert. When all requested directions are paused, the worker exits and
sets `DATA_CHECK_ENABLED=false`; this prevents the admin page from reporting a
running task after its worker has stopped. Use **恢复并继续** to clear the
pause and start it again.

## SQL matching design

The normal validation path does not use `IN` and does not compare rows in
JavaScript. For every expected RPC row, it issues a parameterized SQL query
whose predicates contain the epoch, the business position columns, and all
non-auto-increment columns. A row is valid only when the query returns exactly
one match. Queries for independent expected rows and tables may run in
parallel, bounded by the Sequelize connection pool.

The epoch total is checked separately so extra database rows are detected.
Partitioned address tables include `addressId` in both the row predicate and
the epoch scope. `censor_item` is intentionally excluded from this checker.

The chain-derived table match columns are:

| Table | Position columns | Additional columns |
| --- | --- | --- |
| `cfx_transfer_2` | `epoch, blockIndex, txIndex, txLogIndex` | `createdAt, fromId, toId, value, type` |
| `erc20transfer_3` | `epoch, blockIndex, txIndex, txLogIndex` | `createdAt, contractId, fromId, toId, value` |
| `erc721transfer_3` | `epoch, blockIndex, txIndex, txLogIndex` | `createdAt, contractId, fromId, toId, tokenId` |
| `erc1155transfer_3` | `epoch, blockIndex, txIndex, txLogIndex, batchIndex` | `createdAt, contractId, fromId, toId, value, tokenId` |
| `nft_transfer` | `epoch, blockIndex, txIndex, txLogIndex, batchIndex` | `createdAt, fromId, toId, contractId, tokenId, value, type` |

`full_block` and `full_tx` use their composite primary keys and compare all
stored business fields. `address_transfer`, `address_nft_transfer`, and
`epoch_address_ids` use their composite keys and address partition scope.

## Diagnostics and lifecycle

The fast path records match/total counts and timing. Only when a row match or
epoch total fails does the checker load the affected epoch for diagnostics and
report missing, duplicate, extra, and field-mismatch details. A paused
direction is not logged every interval, avoiding container log flooding.

Admin start stores the interval in KV and launches the detached worker. Start
does not clear an existing pause; use resume when a mismatch has been reviewed.
