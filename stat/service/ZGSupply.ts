import {JsonRpcProvider} from "@ethersproject/providers/src.ts/json-rpc-provider";
import {getCfxSdk, initEthSdk} from "./common/utils";
import {
	BlockWithdrawCreationAttributes,
	BlockWithdrawModel,
	getLatestBlockWithdraw,
	initBlockWithdrawModel, sumEffectiveBalanceBigInt, ValidatorResponse,
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
import {ConfigInstance, NoCoreSpace} from "../config/StatConfig";
import {Conflux} from "js-conflux-sdk";

const ctx = {
	preEntry: null as BlockWithdrawCreationAttributes,
	eth: undefined as JsonRpcProvider,
	cumulative: 0n,
}

async function getBlockWithdraws(p: JsonRpcProvider, blockNumber: number) {
	// raw rpc
	const rawBlock = await p.send('eth_getBlockByNumber', ['0x'+blockNumber.toString(16), false])
	if (!rawBlock) {
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
	} else {
		ctx.cumulative = parseEther(ctx.preEntry.cumulativeAmount).toBigInt()
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
			continue;
		}
		const newBean = {
			blockNumber: withdrawData.blockNumber,
			sumAmount: withdrawData.totalAmount,
			withdrawalsRoot: withdrawData.withdrawalsRoot,
		} as BlockWithdrawCreationAttributes;
		// we have decimal in DB
		const drip = ctx.cumulative + BigInt(withdrawData.totalAmount);
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
		blockWithdraw = BigInt(parseEther(bw?.cumulativeAmount || "0")) * BigInt(1e9);
	}
	const sumContracts = await sumSpecialContractBalance(getCfxSdk()).catch(e=>{
		console.log(`failed to sum contract balance:`, e);
		return BigInt(0);
	})
	const {balance: totalStakes, message: validatorMessage} = await sumValidatorBalance();
	const issued = ZGGenesisSupply + blockWithdraw + totalStakes;
	// home dashboard service will do the algorithm : N - balanceOfZero;
	const remain = issued - sumContracts.valueOf();
	return {
		sumContracts,
		sumBlockWithdrawal: blockWithdraw,
		genesisSupply: ZGGenesisSupply,
		totalCirculating: remain,
		calculateEvmPosSupply: true,
		totalIssued: issued,
		totalStakes,
		validatorMessage,
		// do not care fields below
		totalCollateral: undefined,
		totalEspaceTokens: undefined,
		totalStaking: undefined,
	};
}

async function sumValidatorBalance(rpc?: string) {
	const ret = {balance: BigInt(0), message: ""};
	const rpcUsed = rpc || ConfigInstance.validatorRpc || ''
	if (!rpcUsed) {
		ret.message = "validator RPC is not set"
		return ret;
	}

	const data =  await fetch(rpcUsed).then(res=>res.json()).catch(e=>{
		console.log(`failed to fetch validator info:`, e)
		ret.message = `failed to fetch validator info: ` + e.message;
		return null as ValidatorResponse;
	})
	if (!data) {
		return ret;
	}

	return {balance: sumEffectiveBalanceBigInt(data) * BigInt(1e9), message: undefined };
}

async function sumSpecialContractBalance(cfx:Conflux) {
	if (!cfx) {
		console.log(`cfx is not set`);
		return 0n;
	}
	const arr = [
		"0x739D87653757E834C8CD86407C1Bb2f86a787ecc",
		"0xF5321C5B04f6b702EBD3B8E06BEedA2655a5B8bF",
		"0xdd33275d285FD74A0F0Af369d9Ce335e3C5c5E1f",
		"0x9181b0A31Db3ce580A7cd5A91E115c7a484f2Bc0",
		"0xC16Bc66b220ad6155e43b7F847F6f77d29334717",
		"0x7C46a60e7C98CD1E5cFD98600e867886B3a0226c",
		"0x098DbaD8D4b8B7d8E665FB5f3433802693425419",
		"0xA50d10E7F898F01c3a3742cBF69CDDcFaCFd4438",
		"0xEF1605a64fDCcc84b36fb1c092B698DCF38fD502",
	];
	const bArr = await Promise.all(arr.map(addr=>cfx.getBalance(addr)));
	return bArr.reduce((a, b)=>BigInt(a)+BigInt(b), BigInt(0));
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
