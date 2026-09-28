# AGENTS.md — conflux-scan-backend

Practical knowledge for working in this repo. The "Gotchas" below are real issues
that surfaced as production errors and were fixed on the `misc` branch (commit
messages describe each). Read them before touching the related code paths.

## Repository layout (monorepo-ish)
- `scan-api/` — the **v1** JSON-RPC-style API. Public endpoints live in
  `scan-api/router/v1.ts`; their handlers/logic in `scan-api/router/jsonrpc.ts`
  and `scan-api/service/*`.
- `stat/` — core services, Sequelize models, queries, scheduled stats.
  `stat/service/common/utils.ts` (validators: `checkSolcVersion`, etc.),
  `stat/service/StatsQuery.ts`, `stat/service/nftchecker/*`.
- `open-api/` — EVM / OpenAPI-style endpoints (`/contract/verifysourcecode`, etc.).
  Note: its `compiler` param is the compiler **type** (`solc`/`vyper`), which is a
  different meaning from scan-api's `compiler` (the **version** string).
- `koaflow/` — custom Koa framework (flow composition, OpenAPI, jsonrpc).
- `common/` — shared middleware (`listLimitBy`, `safeFetch`, etc.).

## How a v1 request flows (koaflow)
A route in `scan-api/router/v1.ts` is a chain of flow functions:

```
router_get(router, '/path',
  OpenAPI.flow({ input: { ...schema... } }),  // docs ONLY — see gotcha #A
  toArray,                                    // wraps request body into [body]
  jsonrpc.method_('methodName',
    serializeByIP(),
    buildFlow(app => parameter({ field: { path: '0', type: type.uint, ... } })),
    cacheFlow(5000),
    async function (options) { ... }           // options[0] is the body (from toArray)
  ),
);
```

- `jsonrpc.method_('name', ...fns)` returns a composed flow used as a koa handler.
- Parameter parsing is via `parameter({ field: { path: '0', type: ..., default, '<=N': v => v <= N } })`.
  The `path: '0'` means "read from `options[0]`" (the array element produced by
  `toArray`). Validators are added as extra keys; if parsing/validation fails the
  framework throws `ParameterError`.
- Type system: `koaflow/lib/type.ts` (`type.uint`, `type.int`, `type.string`,
  `type.address`, `type.hex64`, `type.bool`, ...).
- Inside a flow fn, `this` is the koa context; `this.app` exposes
  `{ service, error, config, ttlMap, eth, ... }`.

## Error handling (IMPORTANT)
- Throw **`this.app.error.ParameterError(message)`** for any invalid client input.
- A **plain `Error`** thrown in a flow is treated as unhandled → logged as
  `json-rpc-500-<message>` (UnhandledErrorCode 50001) and raises an alert, even
  though the HTTP status ends up 600.
- `Errors.ParameterError` (code 50101, from `stat/service/common/LogicError`) is the
  correct input-error type → clean 600, no alert.
- RULE: validation/input errors must be `ParameterError`, never a bare `Error`.

## Data layer gotchas
- Sequelize queries with `raw: true` return DB-native types: **DECIMAL → string**.
  Do not assume numeric. Use `BigFixed(String(x))` for arithmetic.
- `BigFixed` (`bigfixed`) is the arbitrary-precision type; it has `.isZero()`,
  `.div()`, `.sub()`, `.add()`. Plain numbers/strings do NOT have these.
- MySQL `LIMIT`/`OFFSET` maximum is 2^63-1 (signed BIGINT). Keep `skip`/`limit`
  within a safe range or the query throws `ER_PARSE_ERROR`.
- `safeFetch` (`stat/service/common/security/safeFetch.ts`) sets `maxRedirects: 0`,
  so a 3xx response is returned as a body (often an HTML "moved" page), NOT
  followed, and `response.data` is raw text. Never `JSON.parse` it blindly.

## Gotchas (with fixes)
- **#A — `OpenAPI.flow` does NOT validate.** It only picks parameters and applies
  `default`; it does NOT enforce `required`/`maximum`/types
  (`koaflow/lib/OpenAPI/Flow.ts`). Do not rely on the schema to reject bad input —
  validate yourself (see traceCallView below).
- **#1 — `skip` overflow.** List endpoints parse `skip` with only `>= 0`. A huge
  `skip` (e.g. `99999999999999999999`) overflows MySQL's offset → SQL parse error.
  Fix: bound `skip` (e.g. `'<=100000000'` validator in `jsonrpc.ts`, and
  `maximum` in `v1.ts` OpenAPI schema). Same applies to any `skip`/`limit` exposed.
- **#2 — contract verify `compiler` needs a `v` prefix (Solidity only).** The
  verify service expects Solidity versions prefixed with `v`
  (`v0.8.24+commit...`). Clients send the raw full form `0.8.24+commit...` (no
  `v`) → "solc version ... not supported". Fix: in the `v1.ts` `/contract/verify`
  route, prepend `v` **only** for the Solidity full-with-commit form
  (`/^\d.*\+commit/`); explicitly leave `vyper:`/`fe:` prefixes and short Solidity
  versions like `0.8.24` (resolved by key lookup) untouched — prepending `v` to
  those breaks them.
- **#3 — unsupported/garbage solc version → 500.** `checkSolcVersion`
  (`stat/service/common/utils.ts`) throws a *bare `Error`* ("...not supported",
  "...required", "Invalid parameter") for bad versions → surfaces as `json-rpc-500`.
  Fix: in `jsonrpc_verifyContract` catch those and rethrow as `ParameterError`.
  (Also covers `code format … not supported`, `EVM version … not supported`,
  vyper/fe variants via the same `not supported` pattern.)
- **#4 — `/v1/trend` `prev.isZero is not a function`.** `StatisticService.trend()`
  did `lodash.mapValues(current, ...)` over *all* keys of a stat row. Rows carry
  `statTime`/`timestamp` metadata (Date/string) and DECIMAL metrics come back as
  **strings** (`raw: true`). Both break `prev.isZero()`/`value.div()`. Fix: iterate
  only the real metric keys (`tps`, `difficulty`, `blockTime`, `hashRate`,
  `transactionGasPrice`) and coerce with `BigFixed(String(v))`.
- **#5 — NFT `get-localized-name` `JSON.parse` of non-JSON.** `safeFetch` returns
  redirect/HTML bodies; `JSON.parse` then throws `Unexpected token ...`. Fix:
  `try/catch` the parse and fall back to `meta.name` (`NFTPreviewService.getNFTName`).
- **#6 — `/v1/traceCallView` 500 on missing `params`.** `ConfluxService.getCallTrace`
  built its cache key with `crypto hash.update(JSON.stringify(params))` *before*
  validating `params`. `JSON.stringify(undefined)` returns the value `undefined`
  (not a string) → `hash.update(undefined)` throws `ERR_INVALID_ARG_TYPE`. Fix:
  validate `params` (array, 1–3 elems, non-empty `callParams`) *before* hashing.

## Where to look for common tasks
- v1 endpoints / handlers: `scan-api/router/v1.ts`, `scan-api/router/jsonrpc.ts`.
- Contract verification: `scan-api/service/ContractService.ts`,
  `stat/service/ContractQuery.ts`, version checks in `stat/service/common/utils.ts`.
- NFT preview/metadata: `stat/service/nftchecker/NFTPreviewService.ts`,
  `NFTMetaUtil.ts`; fetch hardening in `stat/service/common/security/safeFetch.ts`.
- Stats/trend: `scan-api/service/StatisticService.ts`, `stat/service/StatsQuery.ts`,
  `stat/model/DailyBlockDataStat.ts`.

## Workflow notes (from this session)
- Fixes were collected on the `misc` branch, committed one-per-issue, and pushed.
- A PR could NOT be auto-created here: no `gh` CLI and no `GH_TOKEN` (git auth is
  SSH). Open the PR manually at
  `https://github.com/Conflux-Chain/conflux-scan-backend/pull/new/<branch>`.
- Build/test commands were not verified in this session — check `package.json`
  scripts before relying on them.
