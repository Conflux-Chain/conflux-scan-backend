# Core address resolution deployment

`e_space_hex40.hexId` identifies the same eSpace address in `hex40`. It is
not a reference to the original Core caller. The nullable `coreHex` column
stores those original Core bytes separately. The API verifies that their
Keccak-256 hash ends in the requested eSpace address before returning CIP-37.

1. Apply `stat/model/ESpaceHex40Map.sql` to the Core database before deploying
   the updated API or CfxTransferSync. Existing rows remain nullable.
2. Compile and deploy the code. Valid native calls to CrossSpaceCall record
   the caller's mapping. Ordinary eSpace observations preserve existing mappings.

No historical backfill is included or run. Existing rows keep a null `coreHex`
until a subsequent valid native call to CrossSpaceCall records their mapping.
Unresolved legacy rows return the existing
`Cross-space mapped address not found` parameter error.

Regression checks: `node --test open-api/test/resolveCoreSpaceAddress.test.cjs`.
