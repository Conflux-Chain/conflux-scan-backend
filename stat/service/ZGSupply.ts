import {JsonRpcProvider} from "@ethersproject/providers/src.ts/json-rpc-provider";
import {initEthSdk} from "./common/utils";
import {
	BlockWithdrawCreationAttributes,
	BlockWithdrawModel,
	getLatestBlockWithdraw,
	initBlockWithdrawModel,
	initWithdrawalModel,
	WithdrawalCreationAttributes,
	WithdrawalParser,
	WithdrawalUtils
} from "../model/ZG";
import {init} from "./tool/FixDailyTokenStat";
import {KV} from "../model/KV";
import {Sequelize} from "sequelize";
import {regExitHook, sleep} from "./tool/ProcessTool";
import {formatEther, parseEther} from "ethers/lib/utils";

const ctx = {
	preEntry: null as BlockWithdrawCreationAttributes,
	eth: undefined as JsonRpcProvider,
	cumulative: 0,
}

async function getBlockWithdraws(p: JsonRpcProvider, blockNumber: number) {
	// raw rpc
	const rawBlock = await p.send('eth_getBlockByNumber', ['0x'+blockNumber.toString(16), false])
	// console.log(`raw block is `, rawBlock['withdrawals'])
	// console.log(`withdrawalsRoot`, rawBlock['withdrawalsRoot'])

	const wd =  WithdrawalParser.parseWithdrawalsData(rawBlock)
	// console.log(`withdrawals data`, wd)

	const nonZeroWithdrawals = WithdrawalUtils.filterNonZeroWithdrawals(wd.withdrawals);
	// each withdraw
	const beans = nonZeroWithdrawals.map(w=>{
		return {
			id: 0, blockNo: wd.blockNumber,
			address: w.address, amount: w.amount,
			wIndex: w.index, validatorIndex: w.validatorIndex,
		} as WithdrawalCreationAttributes
	})
	return {
		withdrawData: wd, withdraws: beans
	}
}

async function setupPreBlock() {
	ctx.preEntry = await getLatestBlockWithdraw();
	if (!ctx.preEntry) {
		const firstBlk = await ctx.eth.getBlock("earliest");
		ctx.preEntry = {
			blockNumber: firstBlk.number - 1, sumAmount: 0, cumulativeAmount: '0',
			withdrawalsRoot: '',
		}
		// no record in DB,
		console.log(`first block number is `, firstBlk.number);
	}
}

async function sync(seq?: Sequelize) {
	let useSeq = seq;
	if (!useSeq) {
		const cfg = await init();
		useSeq = KV.sequelize;
		regExitHook();
	}
	// initWithdrawalModel(useSeq);
	initBlockWithdrawModel(useSeq);
	await useSeq.sync({});

	await setupPreBlock();
	let round = 0;
	while (true) {
		const wantBlockNo = ctx.preEntry.blockNumber + 1;
		let failed = false
		const {withdrawData} = await getBlockWithdraws(ctx.eth, wantBlockNo).catch(e=>{
			console.log(`failed to get block withdraws at ${wantBlockNo}:`, e)
			failed = true;
			return {withdrawData: null}
		});
		if (failed) {
			await sleep(5_000);
		}
		const newBean = {
			blockNumber: withdrawData.blockNumber,
			sumAmount: withdrawData.totalAmount,
			withdrawalsRoot: withdrawData.withdrawalsRoot,
		} as BlockWithdrawCreationAttributes;
		// we have decimal in DB
		const drip = ctx.cumulative + withdrawData.totalAmount;
		newBean.cumulativeAmount = formatEther(drip);

		await BlockWithdrawModel.create(newBean).then(()=>{
			ctx.preEntry = newBean;
			ctx.cumulative = drip;
		}).catch(async e=>{
			console.log(`failed to save block withdraw model:`, e)
			await sleep(5_000);
		});

		if ((round ++) % 1000 === 0) {
			console.log(`${new Date().toISOString()} reach block `, ctx.preEntry.blockNumber);
		}
	}
}

async function main() {
	const [,,cdm, arg1] = process.argv;
	const url = ""
	ctx.eth = await initEthSdk(arg1 || url);
	// await getBlockWithdraws(eth, 1)
	await sync()
}

if (module === require.main) {
	main()
}
