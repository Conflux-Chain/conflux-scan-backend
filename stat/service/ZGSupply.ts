import {JsonRpcProvider} from "@ethersproject/providers/src.ts/json-rpc-provider";
import {initEthSdk} from "./common/utils";
import {
	BlockWithdrawCreationAttributes,
	BlockWithdrawModel,
	getLatestBlockWithdraw,
	initBlockWithdrawModel,
	WithdrawalCreationAttributes,
	WithdrawalParser,
	WithdrawalUtils
} from "../model/ZG";
import {init} from "./tool/FixDailyTokenStat";
import {KV} from "../model/KV";
import {Sequelize} from "sequelize";
import {regExitHook, sleep} from "./tool/ProcessTool";
import {formatEther, parseEther} from "ethers/lib/utils";
import {SupplyInfo} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {NoCoreSpace} from "../config/StatConfig";

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
	if (!rawBlock) {
		console.log(`getting block returns null at`, blockNumber);
		return {message: `getting block returns null`};
	}
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
		if (failed || !withdrawData) {
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

const ZGGenesisSupply = BigInt(parseEther(1e9.toString()));

export async function calculateEvmPosSupply(balanceOfZero: bigint): Promise<SupplyInfo & any> {
	// circulating supply = genesis supply + block withdraw - balance(0x0)
	let blockWithdraw = BigInt(0);
	if (NoCoreSpace && BlockWithdrawModel.sequelize) {
		const bw = await getLatestBlockWithdraw();
		blockWithdraw = BigInt(parseEther(bw?.cumulativeAmount || "0"));
	}
	const issued = ZGGenesisSupply + blockWithdraw;
	// const circulating = issued - balanceOfZero;
	// ret['sumBlockWithdraw'] = blockWithdraw;
	return {
		sumBlockWithdraw: blockWithdraw,
		genesisSupply: ZGGenesisSupply,
		// home dashboard service will do the algorithm : issued - balanceOfZero;
		totalCirculating: issued, //circulating,
		totalCollateral: 0n,
		totalEspaceTokens: 0n,
		totalIssued: issued,
		totalStaking: 0n,
		calculateEvmPosSupply: true,
	};
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
