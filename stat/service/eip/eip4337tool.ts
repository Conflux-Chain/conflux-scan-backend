process.env.TZ = 'UTC';

import {Op} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {init} from "../tool/FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";
import {AddressTransactionIndex} from "../../model/FullBlock";
import {AATx, BundleTx, entrypointAddrSet} from "../../model/eip4337model";
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
	} else {
		console.log(`unknown cmd: ${cmd}`);
	}

	await AATx.sequelize?.close();
	process.exit(0);
}

if (require.main === module) {
	main().then();
}
