# Core address resolution deployment

`e_space_hex40.hexId` identifies the same eSpace address in `hex40`. It is
not a reference to the original Core caller. The nullable `coreHex` column
stores those original Core bytes separately. The API verifies that their
Keccak-256 hash ends in the requested eSpace address before returning CIP-37.

1. Apply `stat/model/ESpaceHex40Map.sql` to the Core database before deploying
   the updated API or CfxTransferSync. Existing rows remain nullable.
2. Compile and deploy the code. Valid native calls to CrossSpaceCall record
   the caller's mapping. Ordinary eSpace observations preserve existing mappings.
3. Run `node stat/service/tool/BackfillCoreSpaceMapping.js` with the usual
   production database configuration to fill historical mappings. This walks
   `hex40` in batches and hashes known address bytes, then updates matching
   `e_space_hex40` rows via indexed `hexId` lookups. It does not create mappings
   for addresses absent from `e_space_hex40`.

The backfill is repeatable and only fills null values. To resume after an
interruption, pass the last logged completed hex40 ID as the first argument.
Until backfill completes, unresolved legacy rows return the existing
`Cross-space mapped address not found` parameter error. A Core preimage absent
from the local address data remains unresolved.

Regression checks: `node --test open-api/test/resolveCoreSpaceAddress.test.cjs`.
