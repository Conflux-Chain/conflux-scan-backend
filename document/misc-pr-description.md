# Fix API pagination, verification, trends, trace validation, and NFT localization

This PR addresses production API failures caused by oversized pagination offsets,
compiler input validation, unexpected statistics value types, missing trace
parameters, and malformed NFT localization responses.

## Behavior changes

- Bound `skip` to `0..100000000`, defaulting to `0`, for block, transaction, token,
  and transfer lists and both transaction and transfer reports. Public schemas
  match runtime validation, preventing oversized offsets from reaching MySQL.
- Normalize full Solidity compiler versions containing `+commit` by adding a
  missing `v` prefix on `/v1/contract/verify`. Short Solidity versions, already
  prefixed versions, and Vyper/Fe inputs retain their existing handling.
- Return parameter errors for recognized contract-verification input failures,
  including unsupported compiler versions, missing versions, invalid parameters,
  and unmatched library pairs. Other errors continue to propagate.
- Calculate `/v1/trend` using only `tps`, `difficulty`, `blockTime`, and `hashRate`,
  converting raw decimal strings to BigFixed before arithmetic. Exclude timestamp
  metadata and remove the unavailable `transactionGasPrice` field from both the
  result and response schema. Missing values and zero baselines produce zero
  values or trends as appropriate.
- Validate trace-call parameters before hashing the cache key: require an array
  containing one to three entries with a nonempty first argument. Missing or
  rejected parameters produce parameter errors instead of failing during hashing.
- Preserve the original NFT name when a successful localization fetch returns
  malformed JSON, non-JSON content, or no localized name. This changes response
  parsing only; redirects remain disabled and fetch failures retain existing
  error logging.

## Validation

- `npm run compile` passed for the code changes.
- Isolated trend checks with mocked query results passed for minute, hour, and
  day intervals, decimal strings and BigFixed values, metadata exclusion, absent
  gas prices, zero baselines, and empty results.
- Pagination, compiler normalization, verification error mapping, trace
  validation, and NFT localization changes were inspected. These paths were not
  integration-tested against live database, RPC, verification, or NFT services.
