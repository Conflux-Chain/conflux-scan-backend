import {getDelegatedAddrAtTx} from "../../model/EIP7702model";

process.env.TZ = 'UTC';

import {Op, QueryTypes} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {init} from "../tool/FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";
import {AddressTransactionIndex} from "../../model/FullBlock";
import {AATx, BundleTx, entrypointAddrSet, T_ADDR_AA_TX} from "../../model/eip4337model";
import {makeIdV} from "../../model/HexMap";
import {setupEntrypointIds, syncEpoch} from "./eip4337";

const PAGE = 1000;

/**
 * Find epochs that have transactions to any EntryPoint in address_tx but are absent
 * from bundleTx, then re-sync each missing epoch using syncEpoch.
 *
 * Usage:
 *   node stat/service/eip/eip4337tool.js fixMissing [fromEpoch] [toEpoch]
 *
 * fromEpoch / toEpoch are optional. If omitted the full history is scanned.
 */
async function fixMissingAATx(cfx: Conflux, fromEpoch?: number, toEpoch?: number): Promise<void> {
	// Resolve each entrypoint address to its DB id.
	const entrypointIds: number[] = [];
	for (const addr of entrypointAddrSet) {
		const id = await makeIdV(addr, null, {dt: new Date()});
		if (id != null) entrypointIds.push(id as number);
	}
	if (entrypointIds.length === 0) {
		console.log('No entrypoint ids found in DB — nothing to fix.');
		return;
	}
	console.log(`Entrypoint DB ids: ${entrypointIds.join(', ')}`);

	// Collect candidate epochs page-by-page per entrypoint, using epoch as cursor.
	const candidateEpochSet = new Set<number>();
	for (const toId of entrypointIds) {
		let cursor = fromEpoch ?? 0;
		while (true) {
			const where: any = {
				addressId: toId,
				toId, epoch: { [Op.gte]: cursor }
			};
			if (toEpoch != null) where.epoch[Op.lte] = toEpoch;
			const rows = await AddressTransactionIndex.findAll({
				where,
				attributes: ['epoch'],
				order: [['epoch', 'ASC']],
				limit: PAGE,
				raw: true,
			}) as any[];
			if (rows.length === 0) break;
			for (const r of rows) candidateEpochSet.add(Number(r.epoch));
			if (rows.length < PAGE) break;
			cursor = Number(rows[rows.length - 1].epoch) + 1;
		}
	}

	const candidateEpochs = [...candidateEpochSet].sort((a, b) => a - b);
	console.log(`Found ${candidateEpochs.length} candidate epoch(s) in address_tx.`);
	if (candidateEpochs.length === 0) return;

	// Find which of those epochs already have a bundleTx record.
	const existing = await BundleTx.findAll({
		where: { epoch: { [Op.in]: candidateEpochs } },
		attributes: ['epoch'],
		group: ['epoch'],
		raw: true,
	}) as any[];
	const existingSet = new Set(existing.map((r: any) => Number(r.epoch)));

	const missing = candidateEpochs.filter(e => !existingSet.has(e));
	console.log(`${missing.length} epoch(s) missing from bundleTx — will re-sync.`);

	let fixed = 0;
	for (const epoch of missing) {
		try {
			console.log(`[${fixed + 1}/${missing.length}] Syncing epoch ${epoch}...`);
			await syncEpoch(cfx, epoch, null);
			fixed++;
		} catch (e) {
			console.error(`  Failed epoch ${epoch}:`, e);
		}
	}
	console.log(`Done. Fixed ${fixed}/${missing.length} epochs.`);
}

/*
npx tsc && node stat/service/eip/eip4337tool.js fixMissing                        # scan all history
npx tsc && node stat/service/eip/eip4337tool.js fixMissing 250000000              # from epoch
npx tsc && node stat/service/eip/eip4337tool.js fixMissing 250000000 252000000    # range
npx tsc && node stat/service/eip/eip4337tool.js fixPositions                      # backfill position field
npx tsc && node stat/service/eip/eip4337tool.js backfillPartition                 # backfill aaTx into sender partition table
npx tsc && node stat/service/eip/eip4337tool.js backfillPartition 10000           # custom batch size
 */

const BUNDLE_BATCH = 500;
const AATX_BACKFILL_BATCH = 5000;

/**
 * Backfill the `position` column for all existing aaTx rows.
 *
 * For every bundle tx, the userOps were inserted in log-event order, so
 * ranking each aaTx row by `id ASC` within its `bundleTxId` gives the
 * correct 0-based position.
 *
 * Processes BUNDLE_BATCH bundle txs at a time using a raw SQL window-function
 * UPDATE to avoid row-by-row overhead.
 */
async function fixAATxPositions(): Promise<void> {
	let cursor = BigInt(0);
	let totalBundles = 0;
	let batchNum = 0;

	while (true) {
		const bundles = await BundleTx.findAll({
			where: { id: { [Op.gt]: cursor } },
			attributes: ['id'],
			order: [['id', 'ASC']],
			limit: BUNDLE_BATCH,
			raw: true,
		}) as any[];

		if (bundles.length === 0) break;

		batchNum++;
		const bundleIds = bundles.map((b: any) => BigInt(b.id));
		cursor = bundleIds[bundleIds.length - 1];

		// Assign position = (row rank - 1) within each bundleTxId, ordered by id
		await AATx.sequelize.query(`
			UPDATE aaTx a
			JOIN (
				SELECT id,
				       ROW_NUMBER() OVER (PARTITION BY bundleTxId ORDER BY id) - 1 AS rn
				FROM aaTx
				WHERE bundleTxId IN (:ids)
			) AS ranked ON a.id = ranked.id
			SET a.position = ranked.rn
		`, {
			replacements: { ids: bundleIds.map(String) },
			type: QueryTypes.UPDATE,
		});

		totalBundles += bundles.length;
		console.log(`Batch ${batchNum}: processed ${bundles.length} bundle txs (total ${totalBundles})`);

		if (bundles.length < BUNDLE_BATCH) break;
	}

	console.log(`Done. Fixed positions for ${totalBundles} bundle txs.`);
}

/**
 * Backfill historical rows from `aaTx` into sender-partitioned table.
 *
 * Idempotent behavior: rows are inserted only when a matching
 * (userOpHash, epoch, bundleTxId, position) row does not already exist
 * in the target table.
 */
async function backfillAddrAATx(batchSize = AATX_BACKFILL_BATCH): Promise<void> {
	let cursor = BigInt(0);
	let batchNum = 0;
	let scannedRows = 0;
	let insertedRows = 0;

	while (true) {
		const sourceRows = await AATx.findAll({
			where: { id: { [Op.gt]: cursor } },
			attributes: ['id'],
			order: [['id', 'ASC']],
			limit: batchSize,
			raw: true,
		}) as any[];

		if (sourceRows.length === 0) {
			break;
		}

		batchNum += 1;
		scannedRows += sourceRows.length;
		const maxId = BigInt(sourceRows[sourceRows.length - 1].id);

		const [_, meta] = await AATx.sequelize.query(`
			INSERT INTO ${T_ADDR_AA_TX} (
				userOpHash, epoch, senderId, bundlerId, eventContractId,
				entryPointId, bundleTxId, paymasterId, nonce, position,
				success, actualGasCost, actualGasUsed, methods, method7702,
				createdAt, updatedAt
			)
			SELECT
				s.userOpHash, s.epoch, s.senderId, s.bundlerId, s.eventContractId,
				s.entryPointId, s.bundleTxId, s.paymasterId, s.nonce, s.position,
				s.success, s.actualGasCost, s.actualGasUsed, s.methods, s.method7702,
				s.createdAt, s.updatedAt
			FROM aaTx s
			LEFT JOIN ${T_ADDR_AA_TX} t
				ON t.userOpHash = s.userOpHash
				AND t.epoch = s.epoch
				AND t.bundleTxId = s.bundleTxId
				AND t.position = s.position
			WHERE s.id > :cursor AND s.id <= :maxId AND t.id IS NULL
		`, {
			replacements: { cursor: cursor.toString(), maxId: maxId.toString() },
			type: QueryTypes.INSERT,
		});

		const affected = Number((meta as any) || 0);
		insertedRows += Number.isFinite(affected) ? affected : 0;
		cursor = maxId;

		console.log(`backfill batch ${batchNum}: scanned=${sourceRows.length} inserted=${affected} cursor=${cursor}`);

		if (sourceRows.length < batchSize) {
			break;
		}
	}

	console.log(`backfill done: scanned=${scannedRows} inserted=${insertedRows}`);
}

/*
node stat/service/eip/eip4337tool.js debugEffectiveAuth
 */
async function main() {
	const [,, cmd, fromEpochStr, toEpochStr] = process.argv;
	if (cmd === 'fixMissing') {
		const fromEpoch = fromEpochStr ? parseInt(fromEpochStr) : undefined;
		const toEpoch   = toEpochStr   ? parseInt(toEpochStr)   : undefined;
		console.log(`fixMissing fromEpoch=${fromEpoch ?? 'all'} toEpoch=${toEpoch ?? 'all'}`);
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		await setupEntrypointIds();
		await fixMissingAATx(cfx, fromEpoch, toEpoch);
	} else if (cmd === 'debugEffectiveAuth') {
		const cfg = await init();
		const cfx = await initCfxSdk(cfg.conflux);
		const [,,,arg1, arg2, arg3] = process.argv;
		const eoa = arg1 || "0xE5545c5B806e5d426136eb3D118A2bDaB47DCa55";
		const blockNumber = arg2 ? parseInt(arg2) : 255656710;
		const txHash = arg3 || "0x1857a44af138ef04cc16778dcf4397ec6231036037c086cfbcb3bf0f0029d731";
		const info = await getDelegatedAddrAtTx(eoa, blockNumber, txHash, true);
		console.log(`that is `, info);
	} else if (cmd === 'fixPositions') {
		console.log('fixPositions: backfilling position field for all aaTx rows...');
		await init();
		await fixAATxPositions();
	} else if (cmd === 'backfillPartition') {
		const batchSizeRaw = fromEpochStr ? parseInt(fromEpochStr) : AATX_BACKFILL_BATCH;
		const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? batchSizeRaw : AATX_BACKFILL_BATCH;
		console.log(`backfillPartition: batchSize=${batchSize}`);
		await init();
		await backfillAddrAATx(batchSize);
	} else {
		console.log(`unknown cmd: ${cmd}`);
	}

	await AATx.sequelize?.close();
	process.exit(0);
}

if (require.main === module) {
	main().then();
}
