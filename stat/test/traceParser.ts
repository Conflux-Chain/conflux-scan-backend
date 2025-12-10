import {init} from "../service/tool/FixDailyTokenStat";
import {Trace} from "../model/CfxTransfer";
import {iterateTable} from "../../tools/tableIterator";
import {ContractDecoder} from "../../tools/contractDecoder";
import {abi as sponsorAbi} from "../service/abi/SponsorWhitelistControl";

async function processTrace(trace: any) {
	// 这里写你的处理逻辑
	console.log(`处理 epoch ${trace.epoch}, block ${trace.blockIndex}`);

	const decoder = new ContractDecoder();
	const iFace = decoder.getInterface(sponsorAbi);
	// 示例：更新某些字段
	if (trace.to === '0x0888000000000000000000000000000000000001'
		&& trace.input && trace.valid
		&& trace.input.startsWith('0x')) {
		// 执行一些操作
		const parsedTransaction = iFace.parseTransaction({ data: trace.input });
		if (parsedTransaction) {
			console.log(`that is `, parsedTransaction.name, parsedTransaction.args);
		}
	}
}

async function main() {
	await init({alter: true});
	await iterateTable(Trace, processTrace, 1);

	process.exit(0);
}


if (module === require.main) {
	main()
}
