import {init} from "../service/tool/FixDailyTokenStat";
import {ITrace, Trace} from "../model/CfxTransfer";
import {iterateTable} from "../../tools/tableIterator";
import {ContractDecoder, transformNamedArgs} from "../../tools/contractDecoder";
import {abi as adminAbi} from "../service/abi/AdminControl";
import {abi as sponsorAbi} from "../service/abi/SponsorWhitelistControl";
import {abi as stakingAbi} from "../service/abi/Staking";
import {abi as ctxAbi} from "../service/abi/ConfluxContext";
import {abi as posRegAbi} from "../service/abi/PoSRegister";
import {abi as xSpaceAbi} from "../service/abi/CrossSpaceCall";
import {abi as paramAbi} from "../service/abi/ParamsControl";
import {Interface} from "ethers/lib/utils";
import {dingMsg} from "../monitor/Monitor";
import {ConfigInstance} from "../config/StatConfig";

const decoder = new ContractDecoder();
const iFaceAdmin = decoder.getInterface(adminAbi); iFaceAdmin['name'] = 'admin';
const iFaceSp = decoder.getInterface(sponsorAbi); iFaceSp['name'] = 'sponsor';
const iFaceStaking = decoder.getInterface(stakingAbi); iFaceStaking['name'] = 'staking';
const iFaceCtx = decoder.getInterface(ctxAbi); iFaceCtx['name'] = 'context';
const iFacePos = decoder.getInterface(posRegAbi); iFacePos['name'] = 'posRegister';
const iFaceXSpace = decoder.getInterface(xSpaceAbi); iFaceXSpace['name'] = 'xSpace';
const iFaceParam = decoder.getInterface(paramAbi); iFaceParam['name'] = 'param';

async function processTrace(trace: ITrace) {
	if (!trace.to || !trace.input) {
		return;
	}
	// 这里写你的处理逻辑
	// console.log(`处理 epoch ${trace.epoch}, block ${trace.blockIndex}`);
	let iFace:Interface = decoder.getInterface([]);
	switch (trace.to) {
		case '0x0888000000000000000000000000000000000000': iFace = iFaceAdmin; break;
		case '0x0888000000000000000000000000000000000001': iFace = iFaceSp; break;
		case '0x0888000000000000000000000000000000000002': iFace = iFaceStaking; break;
		case '0x0888000000000000000000000000000000000003': iFace = iFaceCtx; break;
		case '0x0888000000000000000000000000000000000004': iFace = iFaceCtx; break;
		case '0x0888000000000000000000000000000000000005': iFace = iFacePos; break;
		case '0x0888000000000000000000000000000000000006': iFace = iFaceXSpace; break;
		default: {
			await dingMsg(`unknown contract ${trace.to} when processing trace`, ConfigInstance.dingDevToken);
			console.log(`unknown contract: ${trace.to}`, trace);
			process.exit(1)
		}
	}

	// 示例：更新某些字段
	if (trace.input && trace.valid
		&& trace.input.startsWith('0x')) {
		// 执行一些操作
		const parsedTransaction = iFace.parseTransaction({ data: trace.input });
		if (parsedTransaction) {
			const propArg = transformNamedArgs(parsedTransaction.args);
			console.log(`call to ${iFace['name']} `, parsedTransaction.name, propArg);
		}
	}
}

async function main() {
	await init();
	await iterateTable(Trace, processTrace, 1);

	process.exit(0);
}


if (module === require.main) {
	main()
}
