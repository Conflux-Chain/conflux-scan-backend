import { init } from "./FixDailyTokenStat";
import {FullBlock} from "../../model/FullBlock";
import { Op } from "sequelize";
import {initCfxSdk} from "../common/utils";
import {KV} from "../../model/KV";
import {Conflux} from "js-conflux-sdk";
import {sleep} from "./ProcessTool";

const cursorKey = 'update-block-gas&limit-2026.6.12';

async function tryGetBlock(cfx: Conflux, b: FullBlock) {
	while(true) {
		const rpcBlock = await cfx.getBlockByHash(b.hash).catch(e=>{
			console.log(`failed to get block ${b.hash}`, e);
			return null;
		});
		if (!rpcBlock) {
			await sleep(5_000);
			continue;
		}
		return rpcBlock;
	}
}

async function main() {
	const [,,cmd] = process.argv;
	const cfg = await init();
	if (cmd === 'clearProgress') {
		await KV.destroy({where: {key: cursorKey}});
		console.log(cmd);
	}
	const block = await FullBlock.findOne({order: [['epoch', 'desc']]});
	const blockMin = await FullBlock.findOne({order: [['epoch', 'asc']]});
	let ep = await KV.getNumber(cursorKey, block.epoch);
	const cfx = await initCfxSdk(cfg.conflux);
	while (ep >= blockMin.epoch) {
		let lower = Math.max(0, ep - 100);
		const list = await FullBlock.findAll({
			attributes: ['epoch', 'hash', 'txCount', 'gasUsed', 'gasLimit'],
			where: {epoch: {[Op.between]: [lower, ep]}, txCount: {[Op.gt]: 0}},
			raw: true,
			},
		);
		for(const b of list) {
			const rpcBlock = await tryGetBlock(cfx, b);
			const dbRet = await FullBlock.update({
				gasLimit: rpcBlock.gasLimit,
				gasUsed: rpcBlock.gasUsed ?? 0,
			}, {
				where: {epoch: b.epoch, hash: b.hash}
			})
			console.log(`update block at epoch ${b.epoch} hash ${b.hash} gas ${b.gasUsed} -> ${rpcBlock.gasUsed
				} limit ${b.gasLimit} -> ${rpcBlock.gasLimit}`, dbRet);
		}
		await KV.saveNumber(cursorKey, ep, null);
		ep = lower - 1;
	}
}

if (module === require.main) {
	main().then();
}

// node stat/service/tool/RebuildBlock.js
