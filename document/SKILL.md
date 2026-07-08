# ConfluxScan Multi-Space Onchain Data Skill

## Skill Summary

Use ConfluxScan OpenAPI to retrieve onchain data from both:

- **Conflux Core Space**
- **Conflux eSpace**

This skill supports account, transaction, transfer, token, NFT, contract, ABI, statistics, and selected advanced protocol data queries.

It is intended for **read-heavy AI agent workflows** such as:

- wallet inspection
- transaction lookup
- token holding checks
- NFT lookup
- contract verification lookup
- ABI/signature decoding
- chain analytics and stats
- eSpace AA / EIP-4337 / EIP-7702 exploration
- cross-space account metadata lookup

---

## Supported Networks and Base URLs

### Mainnet
- **Core Space API**: `https://api.confluxscan.org`
- **eSpace API**: `https://evmapi.confluxscan.org`

### Testnet
- **Core Space API**: `https://api-testnet.confluxscan.org`
- **eSpace API**: `https://evmapi-testnet.confluxscan.org`

### Docs
- Core Space docs: `https://api.confluxscan.org/doc`
- eSpace docs: `https://evmapi.confluxscan.org/doc`

---

## Space Selection Rules

The agent must determine whether the user refers to **Core Space** or **eSpace** before calling APIs.

### Use Core Space when
- the address is a **Conflux base32** address like:
    - `cfx:...`
    - `cfxtest:...`
- the user explicitly says:
    - Core Space
    - Conflux main space
    - CRC20 / CRC721 / CRC1155
    - epoch
    - staking / PoW / PoS / burnt fee
- the task involves Core-specific stats or native Conflux explorer semantics

### Use eSpace when
- the address is a **hex EVM address** like:
    - `0x...`
- the user explicitly says:
    - eSpace
    - EVM
    - ERC20 / ERC721 / ERC1155
    - Ethereum-compatible
    - AA / EIP-4337 / EIP-7702
- the task requires Etherscan-compatible APIs

### If ambiguous
- ask a clarification question if correctness matters
- otherwise infer from input format:
    - `0x...` → eSpace
    - `cfx:...` / `cfxtest:...` → Core Space

---

## Authentication and Rate Limits

### Authentication
The provided specs do not define a strict auth/security scheme object, but some Etherscan-compatible examples mention `apikey`.

Agent guidance:
- if deployment requires API keys, store them as secrets
- attach them only when configured by the runtime environment
- do not invent auth requirements if the endpoint works without one

### Rate Limits
Documented limits:
- **Free**: 5 calls/second, up to 100,000 calls/day
- **Standard**: 20 calls/second, up to 500,000 calls/day
- **Enterprise**: custom

Agent rules:
- avoid bursty parallel calls unless necessary
- prefer exact-resource endpoints over large list scans
- retry idempotent GET requests with backoff on transient failure
- cap pagination and stop early once the question is answered

---

## Global Query Constraints

The agent should respect the documented limits below.

### Pagination
Common constraints:
- maximum `skip`: **10,000**
- maximum `limit`: **100** for many list endpoints
- some stats endpoints allow higher limits:
    - Core Space stats: up to **5000**
    - eSpace stats: up to **2000**
- some endpoints use **cursor-based pagination** instead of skip/limit paging

### Record visibility / prune note
The docs state that:
- block list
- transaction list
- CFX transfer list
- token transfer list

queried by account dimension may only expose the **latest 20,000 records** due to pruning.

Agent rules:
- do not promise complete historical coverage for high-activity accounts
- warn the user when results may be truncated by explorer retention

### Timestamp
- timestamps are in **seconds**
- some response timestamps are ISO strings in advanced endpoints
- normalize output when answering users

---

## Input Normalization Rules

Before calling any endpoint, the agent should normalize and validate inputs.

### Address formats
- **Core Space**: base32 Conflux address
- **eSpace**: `0x` hex EVM address

Do not send a Core base32 address to an eSpace endpoint unless the API explicitly supports cross-space mapping metadata.

### Hash formats
- transaction hashes and userOp hashes are typically `0x` + 64 hex chars
- function selectors are `0x` + 8 hex chars
- event signatures are `0x` + 64 hex chars

### Numeric values
- preserve raw integer strings returned by the API
- where helpful, present both:
    - raw onchain value
    - human-readable formatted amount

### Time filters
Use:
- timestamps when the user refers to date/time windows
- block/epoch filters when the user refers to chain position windows

---

## Response Style Rules

When replying to end users, the agent should:

1. answer the question directly first
2. include the queried identifiers
3. specify the queried space:
    - Core Space
    - eSpace
4. mention if the result is:
    - paginated
    - partial
    - explorer-derived
    - pruned / retention-limited
5. preserve uncertainty when data is unavailable
6. never fabricate balances, ownership, ABI, labels, or decode results

Recommended output structure:
- short answer
- structured summary
- notable caveats
- source attribution

---

## Capability Map

---

# 1. Account and Address Queries

Use these endpoints when the user asks about an address, wallet, holdings, or address metadata.

## Typical user intents
- "What does this address hold?"
- "Show recent transactions for this wallet"
- "Show token transfers for this account"
- "Is this address a contract?"
- "Get labels / ENS / eSpace mapping / proxy implementation info"

---

## 1.1 Account transactions

### Core Space
`GET /account/transactions`

### eSpace
- `GET /account/transactions`
- Etherscan-compatible:
    - `GET /api?module=account&action=txlist`

### Use when
- the user asks for normal transaction history by account
- the user wants sender/receiver transaction records
- the user asks for recent activity

### Useful filters
- account
- from / to
- min/max timestamp
- startBlock / endBlock or min/max epoch depending on space
- sort
- pagination

### Notes
- Core uses `epochNumber`
- eSpace uses `blockNumber`
- Core supports optional `withInput`
- eSpace also has Etherscan-compatible transaction list semantics

---

## 1.2 Native transfer history

### Core Space
`GET /account/cfx/transfers`

### eSpace
- `GET /account/cfx/transfers`
- Etherscan-compatible internal/native style options:
    - `GET /api?module=account&action=txlistinternal`

### Use when
- the user asks about native token transfers
- the user asks "incoming/outgoing CFX transfers"
- the user wants movement of native value, not all txs

---

## 1.3 Fungible token transfer history

### Core Space
`GET /account/crc20/transfers`

### eSpace
- `GET /account/erc20/transfers`
- Etherscan-compatible:
    - `GET /api?module=account&action=tokentx`

### Use when
- the user asks for token transfer activity by wallet
- filtering by token contract is needed

---

## 1.4 NFT transfer history

### Core Space
- `GET /account/crc721/transfers`
- `GET /account/crc1155/transfers`
- `GET /account/crc3525/transfers`

### eSpace
- `GET /account/erc721/transfers`
- `GET /account/erc1155/transfers`
- `GET /account/erc3525/transfers`
- Etherscan-compatible:
    - `GET /api?module=account&action=tokennfttx`
    - `GET /api?module=account&action=token1155tx`

### Use when
- the user asks for NFT activity by account
- token ID filtering is needed
- a specific NFT standard is known

---

## 1.5 Unified transfer history

### Core Space
`GET /account/transfers`

### eSpace
`GET /account/transfers`

### Use when
- the user asks for "all transfers"
- transfer type is unknown
- a unified timeline is preferred

### Important
This endpoint may mix:
- native transfers
- fungible token transfers
- NFT transfers
- other transfer-like movement categories

### Agent behavior
- use `transferType` when the user asks for a narrow subset
- use cursor-based pagination when available
- explain mixed record types clearly

---

## 1.6 Account asset holdings

### Core Space
`GET /account/tokens`

### eSpace
- `GET /account/tokens`
- Etherscan-compatible holdings endpoints:
    - `GET /api?module=account&action=addresstokenbalance`
    - `GET /api?module=account&action=addresstokennftbalance`
    - `GET /api?module=account&action=addresstokennftinventory`

### Use when
- the user asks:
    - "What tokens does this wallet hold?"
    - "Show all assets"
    - "Show ERC20/CRC20 balances"
    - "Show NFT holdings"

### Agent behavior
- prefer `/account/tokens` for broad holdings
- use inventory endpoints if the user asks for exact owned NFT token IDs by contract

---

## 1.7 Account approvals

### Core Space
`GET /account/approvals`

### eSpace
`GET /account/approvals`

### Use when
- the user asks about token approvals / allowances / operator approvals
- the user wants ERC20 / CRC20 or NFT approval exposure

### Caveat
The meaning of approval `value` differs by token standard. The agent should explain:
- fungible token approval amount
- ERC721/CRC721 tokenId approval
- ApprovalForAll flags

---

## 1.8 Account metadata and labels

### Core Space
`GET /account/infos`

### eSpace
`GET /account/infos`

### Use when
- the user asks:
    - "What is this address?"
    - "Does it have a label?"
    - "Does it map to eSpace?"
    - "Does it have ENS?"
    - "Is it a proxy?"

### Optional enrichments
- contract info
- name tag info
- byte32 name tag info
- eSpace info
- ENS info
- proxy implementation info

### Agent behavior
Treat labels and name tags as informational, not authoritative identity proof.

---

# 2. Transaction Queries

Use transaction-specific endpoints when the user provides a tx hash or asks whether a tx succeeded.

## Typical user intents
- "Did this transaction succeed?"
- "Get transaction receipt status"
- "Decode the method call"
- "Show internal transactions"
- "Show contract execution error"

---

## 2.1 Transaction status

### eSpace
- `GET /api?module=transaction&action=getstatus`
- `GET /api?module=transaction&action=gettxreceiptstatus`

### Use when
- the user wants a quick success/failure check
- receipt-level status is sufficient

### Return
- execution status
- error description if available
- receipt status

---

## 2.2 Internal transactions

### eSpace
`GET /api?module=account&action=txlistinternal`

### Use when
- the user wants internal calls
- the query is by:
    - address
    - tx hash
    - block range

### Caveat
Internal transaction records are explorer-derived traces, not base-layer transaction objects.

---

## 2.3 Decode transaction method

### Core Space
- `GET /util/decode/method`
- `GET /util/decode/method/raw`

### eSpace
- `GET /util/decode/method`
- `GET /util/decode/method/raw`

### Use when
- the user asks:
    - "What method did this tx call?"
    - "Decode this calldata"
    - "Explain the input data"

### Caveat
Decoding depends on verified contracts / known ABI mappings.

### Agent behavior
If decode fails:
- report that decoding is unavailable
- provide raw selector/input if helpful
- do not guess method semantics

---

# 3. Contract and ABI Queries

Use these endpoints for ABI lookup, verified source code, deployer info, or signature search.

## Typical user intents
- "Get the ABI of this contract"
- "Is this contract verified?"
- "Who deployed this contract?"
- "Find function signature from selector"
- "Search ABI by method name"

---

## 3.1 Get verified ABI and source code

### Core Space
- `GET /contract/getabi`
- `GET /contract/getsourcecode`

### eSpace
- `GET /api?module=contract&action=getabi`
- `GET /api?module=contract&action=getsourcecode`

### Use when
- the user wants ABI
- the user wants source code
- the user wants compiler / optimization / proxy metadata

---

## 3.2 Contract creation info

### Core Space
`GET /contract/getContractCreation`

### eSpace
`GET /api?module=contract&action=getcontractcreation`

### Use when
- the user asks who deployed a contract
- the user asks for the deployment transaction

### Return
- contract address
- creator address
- tx hash
- block/epoch number
- timestamp
- factory address if applicable

---

## 3.3 Verified contract lists

### Core Space
- `GET /contract/verified`
- `GET /contract/verified/latest`

### eSpace
- `GET /contract/verified`
- `GET /contract/verified/latest`

### Use when
- the user wants recently verified contracts
- the user wants filtered verified contract discovery

### Notes
- cursor endpoint supports forward pagination only
- filter endpoint may enforce a total accessible list limit

---

## 3.4 ABI signature lookup and search

### Core Space
- `GET /contract/lookupAbi`
- `GET /contract/searchAbi`

### eSpace
- `GET /contract/lookupAbi`
- `GET /contract/searchAbi`

### Use when
- the user provides:
    - method selector
    - error selector
    - event topic hash
- the user asks for possible signature matches
- the user asks to search by wildcard signature name

### Agent behavior
- present all candidate matches if there are multiple
- distinguish:
    - function
    - error
    - event

---

## 3.5 Contract verification workflows

### Core Space
- `POST /contract/verifysourcecode`
- `GET /contract/checkverifystatus`
- `GET /contract/verifyproxycontract`
- `GET /contract/checkproxyverification`

### eSpace
- `POST /api`
- `GET /api?module=contract&action=checkverifystatus`
- `GET /api?module=contract&action=verifyproxycontract`
- `GET /api?module=contract&action=checkproxyverification`

### Use when
- the agent is explicitly allowed to assist with contract verification workflow

### Safety rule
Do not submit source verification unless the user explicitly asks to perform the action and the runtime permits write operations.

---

# 4. Token Queries

Use token endpoints for metadata, balances, supply, holders, and token-level analytics.

## Typical user intents
- "What token is this?"
- "Show token metadata"
- "What is the total supply?"
- "Who are the top holders?"
- "How many holders does this token have?"

---

## 4.1 Token metadata

### Core Space
`GET /token/tokeninfos`

### eSpace
- `GET /token/tokeninfos`
- Etherscan-compatible:
    - `GET /api?module=token&action=tokeninfo`

### Use when
- the user wants token name, symbol, decimals, type, icon, or price reference

---

## 4.2 Refresh token info

### Core Space
`POST /token/tokeninfo/refresh`

### eSpace
`POST /token/tokeninfo/refresh`

### Use when
- token metadata is missing and the runtime allows such refresh behavior

### Safety
Treat this as an operational action, not a default read path.

---

## 4.3 Token balance and supply

### eSpace only in Etherscan-compatible style
- `GET /api?module=account&action=tokenbalance`
- `GET /api?module=account&action=tokenbalancehistory`
- `GET /api?module=stats&action=tokensupply`
- `GET /api?module=stats&action=tokensupplyhistory`

### Use when
- exact account balance for a token is needed
- historical token supply or balance at block height is needed

---

## 4.4 Token holders

### eSpace
- `GET /api?module=token&action=tokenholderlist`
- `GET /api?module=token&action=tokenholdercount`
- `GET /api?module=token&action=topholders`

### Use when
- the user asks for holder counts or leaderboard
- current ERC20 holder distribution is needed

### Caveat
Holder data is explorer-derived and may reflect current indexed state, not arbitrary historical snapshots.

---

# 5. NFT Queries

Use NFT endpoints for balances, ownership, token preview, search, and transfer history.

## Typical user intents
- "What NFTs does this wallet own?"
- "Who owns this NFT?"
- "Show NFT metadata"
- "Show transfer history for token #123"
- "Search NFT by name"

---

## 5.1 NFT balances by owner

### Core Space
`GET /nft/balances`

### eSpace
`GET /nft/balances`

### Use when
- the user wants NFT collections held by an account

---

## 5.2 NFT token enumeration

### Core Space
`GET /nft/tokens`

### eSpace
`GET /nft/tokens`

### Use when
- the user wants token IDs for a collection or owner
- the user wants optional brief metadata or full metadata

### Agent behavior
Use:
- `withBrief=true` for lightweight NFT display
- `withMetadata=true` only when the user asks for richer metadata or traits

---

## 5.3 NFT preview

### Core Space
`GET /nft/preview`

### eSpace
`GET /nft/preview`

### Use when
- the user asks about a single NFT by contract + tokenId

---

## 5.4 NFT owner list

### Core Space
`GET /nft/owners`

### eSpace
`GET /nft/owners`

### Use when
- the user asks for owners of:
    - a specific NFT
    - an NFT collection

---

## 5.5 NFT transfer history

### Core Space
`GET /nft/transfers`

### eSpace
`GET /nft/transfers`

### Use when
- the user asks for NFT provenance or transfer timeline

---

## 5.6 NFT search

### Core Space
`GET /nft/fts`

### eSpace
`GET /nft/fts`

### Use when
- the user searches by NFT name and optionally contract

---

# 6. Statistics and Analytics

Use statistics endpoints for market stats, activity trends, top lists, token-level analytics, and chain behavior.

---

## 6.1 Shared high-level stats
Both spaces expose analytics families such as:
- supply
- mining / TPS
- contract deployed / verified
- account growth / active users
- transaction volume
- native transfer stats
- token transfer stats
- top senders / receivers / miners / gas users
- block fee and gas stats
- token holder / unique sender / receiver / participant stats

### Core Space base family
`/statistics/*`

### eSpace mix
- `/statistics/*`
- some Etherscan-compatible stats under `/api?module=stats&action=...`

### Agent behavior
- use these endpoints for dashboards, trend analysis, or market summaries
- avoid using them when the user asks for a precise single account or tx answer

---

## 6.2 Core-specific statistics
Core Space has additional chain-specific stats such as:
- NFT aggregate stats
- PoW reward
- PoS reward
- burnt fee
- burnt rate

Use Core Space when the user asks about Conflux-native economic metrics.

---

## 6.3 eSpace-specific Etherscan-compatible stats
eSpace exposes Etherscan-style stats like:
- block by timestamp
- daily avg block time
- daily block count
- daily avg gas limit
- daily gas used
- daily avg gas price
- daily network utilization
- CFX price
- daily hashrate / difficulty / tx / tx fees / new addresses
- CFX supply

Use these when compatibility with Etherscan-style reporting is useful.

---

# 7. eSpace Advanced Protocol Queries

These are **eSpace-only** advanced features.

---

## 7.1 EIP-7702 authorizations

### Endpoint
`GET /eip7702/auths`

### Use when
- the user asks about EIP-7702 authorization records
- filtering by:
    - author
    - delegated contract address
    - tx sender

### Notes
- results may include listLimit restrictions
- present authorization result fields carefully

---

## 7.2 EIP-4337 bundle transactions

### Endpoints
- `GET /eip4337/bundle-txs`
- `GET /eip4337/bundle-tx`

### Use when
- the user asks about bundler activity
- the user wants bundle-level AA transaction details
- the user wants breakdown of user operations inside a bundle

---

## 7.3 EIP-4337 AA transactions

### Endpoints
- `GET /eip4337/aa-txs`
- `GET /eip4337/aa-tx`

### Use when
- the user asks about smart account / user operation activity
- the user provides a userOp hash
- the user wants gas usage or failure reason for a user operation

### Agent behavior
Explain clearly that:
- a UserOperation is not the same as a normal transaction
- one bundle transaction may contain multiple UserOperations

---

# 8. Utility Queries

---

## 8.1 Detect account type

### eSpace
`GET /util/detectAccountType`

### Use when
- the user asks whether an address is a contract
- the user wants delegation/proxy-like hints in eSpace

---

## 8.2 Server version

### Core Space
`GET /version`

### Use when
- operational diagnostics require checking server version

---

## 8.3 Account enumeration data

### Core Space
`GET /data/accounts`

### eSpace
`GET /data/accounts`

### Use when
- the workflow requires indexed account listing
- generally not for ordinary end-user wallet questions

---

## 8.4 Cross-space metadata

### Core Space / eSpace
`GET /account/infos`

### Use when
- the user wants linked eSpace info from Core metadata
- the agent wants enriched identity/context around an address

---

# Task Routing Guide

This section helps the agent map natural-language requests to endpoints.

---

## Task: Check a wallet's native balance / holdings

### Core Space
Prefer:
- `/account/tokens`

### eSpace
Prefer:
- `/account/tokens`

Alternative exact Etherscan-compatible eSpace balance:
- `/api?module=account&action=balance`
- `/api?module=account&action=balancemulti`

### Output
- space
- native/token asset list
- raw amount
- formatted amount if decimals are known

---

## Task: Show recent transactions for an address

### Core Space
- `/account/transactions`

### eSpace
- `/account/transactions`
- or Etherscan-compatible `/api?module=account&action=txlist`

---

## Task: Show token transfers for a wallet

### Core Space
- `/account/crc20/transfers`

### eSpace
- `/account/erc20/transfers`
- or `/api?module=account&action=tokentx`

---

## Task: Show NFT holdings

### Core Space
- `/nft/balances`
- `/nft/tokens`

### eSpace
- `/nft/balances`
- `/nft/tokens`

---

## Task: Get contract ABI or source

### Core Space
- `/contract/getabi`
- `/contract/getsourcecode`

### eSpace
- `/api?module=contract&action=getabi`
- `/api?module=contract&action=getsourcecode`

---

## Task: Decode calldata or transaction method

### Both spaces
- `/util/decode/method`
- `/util/decode/method/raw`

---

## Task: Find contract deployer

### Core Space
- `/contract/getContractCreation`

### eSpace
- `/api?module=contract&action=getcontractcreation`

---

## Task: Look up method selector or event hash

### Both spaces
- `/contract/lookupAbi`
- `/contract/searchAbi`

---

## Task: Analyze AA / smart account activity

### eSpace only
- `/eip4337/aa-txs`
- `/eip4337/aa-tx`
- `/eip4337/bundle-txs`
- `/eip4337/bundle-tx`
- `/eip7702/auths`

---

# Error Handling Rules

The agent should apply the following rules consistently.

## 4xx-like cases
Interpret as one of:
- invalid address/hash format
- unsupported parameter combination
- pagination overflow
- unavailable resource

## 5xx-like cases
Interpret as:
- temporary upstream failure
- explorer index/service issue

## Retry policy
Retry only:
- safe GET requests
- transient network/server failures

Do not retry:
- invalid parameter errors
- explicit not-found results repeatedly

## Empty results
If the API returns empty lists or null:
- say no indexed data was found
- mention the queried identifier
- mention whether the query may be affected by pruning or indexing lag

---

# Safety and Reliability Rules

1. Do not infer identity from labels alone.
2. Do not equate explorer metadata with cryptographic truth.
3. Do not assume all holdings are exhaustive if the endpoint warns that some tokens may not appear.
4. Do not promise full history beyond explorer retention/pruning limits.
5. Do not claim ABI decode certainty if the contract is unverified or decode fails.
6. Distinguish:
    - transaction
    - internal transaction
    - transfer event
    - user operation
    - bundle transaction
7. Preserve raw values whenever unit conversion may introduce ambiguity.

---

# Recommended Answer Format

```markdown
## Result
[Direct answer]

## Details
- Space: Core Space / eSpace
- Queried identifier: ...
- Status: ...
- Time range / block range: ...
- Records returned: ...

## Key Data
- ...
- ...
- ...

## Notes
- Data source: ConfluxScan OpenAPI
- This result may be partial due to pagination / pruning / indexing limits.
```

---

# Example Behaviors

## Example 1: User asks for an eSpace transaction result
**User:** "Did this tx succeed? 0x..."

**Agent behavior:**
1. Detect `0x...` as eSpace
2. Use:
    - `/api?module=transaction&action=gettxreceiptstatus`
    - optionally `/api?module=transaction&action=getstatus`
3. Return:
    - success/failure
    - error description if available
    - clarify this is eSpace

---

## Example 2: User asks for a Core Space wallet's assets
**User:** "What does this cfx address hold?"

**Agent behavior:**
1. Detect `cfx:...` as Core Space
2. Use `/account/tokens`
3. Return:
    - native CFX balance
    - token list
    - staking amount if present
    - note that some assets may not appear

---

## Example 3: User asks for ABI by selector
**User:** "What is method 0xa9059cbb?"

**Agent behavior:**
1. Use `/contract/lookupAbi`
2. Return:
    - candidate function signatures
    - mention if verified-contract evidence exists

---

## Example 4: User asks for AA activity
**User:** "Check this userOp hash"

**Agent behavior:**
1. Recognize eSpace AA context
2. Use `/eip4337/aa-tx`
3. Return:
    - userOp hash
    - sender
    - bundler
    - entry point
    - success
    - gas used/cost
    - failure reason if any

---

# Implementation Notes for Agent Builders

## Prefer newer structured endpoints when possible
For many workflows, prefer:
- `/account/...`
- `/contract/...`
- `/nft/...`
- `/statistics/...`

over older compatibility endpoints, unless:
- Etherscan-compatible semantics are specifically required
- a capability exists only in the compatibility layer

## Use compatibility endpoints when needed
Especially in eSpace, use `/api?module=...&action=...` for:
- tx receipt status
- internal tx
- token balance history
- token holders
- block by timestamp
- Etherscan-style workflows

## Handle response envelope differences
Core and eSpace do not always use the same top-level response fields.

Possible wrappers include:
- `status / message / result`
- `code / message / data`

The agent should normalize these before reasoning.

---

If you want, I can next turn this into either:

1. a **more compact production-ready skills file**
2. a **YAML tool-routing spec**
3. a **system-prompt style agent instruction doc**
4. a **Markdown doc with endpoint tables for every intent**