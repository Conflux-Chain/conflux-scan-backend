import {ethers, formatEther, parseEther} from "ethers";
import {entryPointV8} from "./entryPointV8.json";
import {COUNT_AA_TX_METHODS} from "../../model/eip4337model";
import {makeIdV} from "../../model/HexMap";

const iface = new ethers.Interface(entryPointV8);

export interface IUserOpParam {
	callData: string;
}

function printInterfaceMethods(abi: any): void {
	const iface = new ethers.Interface(abi);

	console.log("=== Interface Methods ===");
	console.log(`Total functions: ${Object.keys(iface.fragments).length}\n`);

	// Iterate through all fragments
	for (const key in iface.fragments) {
		const fragment = iface.fragments[key];

		// Check if it's a function fragment
		if (fragment.type === "function") {
			const functionName = fragment["name"];
			const signature = fragment.format();
			const methodId = iface.getFunction(functionName)?.selector;

			console.log(`Function: ${functionName}`);
			console.log(`  Signature: ${signature}`);
			console.log(`  Method ID: ${methodId}`);
			console.log(`  Selector (first 4 bytes): ${methodId?.slice(0, 10)}`);
			console.log("");
		}
	}
	console.log("================================");
}

export function parseHandleOps(callData: string): IUserOpParam[] {
	const decoded = iface.parseTransaction({ data: callData });
	if (!decoded) {
		return null;
	}
	// Get decoded arguments
	const [ops, beneficiary] = decoded.args;
	return ops as IUserOpParam[];
}


export interface ExecuteParams {
	dest: string;
	value: bigint;
	func: string;
}
const iface7702 = new ethers.Interface([
	"function execute(address dest, uint256 value, bytes calldata func) external",
	"function executeBatch((address,uint256,bytes)[]) external"
]);
function parse7702execute(callData: string): ExecuteParams[] {
	const decode = iface7702.parseTransaction({ data: callData });
	if (!decode) {
		return null;
	}
	if (decode.name === 'executeBatch') {
		const [rows] = decode.args;
		const ret = [];
		for (let i = 0; i < rows.length; i++) {
			const [dest, value, func] = rows[i];
			ret.push({dest, value, func});
		}
		return ret as ExecuteParams[];
	} else {
		const [dest, value, func] = decode.args;
		return [{dest, value, func}] as ExecuteParams[];
	}
}

export interface IFuncInfo {
	dest: string;
	destId: number;
	func: string;
}

export interface IFuncOfOp {
	funcArr: IFuncInfo[];
	methodIds: string;
}

export async function parseAATxMethods(hex: string, blockTime: Date): Promise<IFuncOfOp[]> {
	const arr = parseHandleOps(hex);
	if (!arr.length) {
		return [];
	}

	const ret: IFuncOfOp[] = []

	for (let i = 0; i < arr.length; i++) {
		const {callData} = arr[i];
		const exec7702arr = parse7702execute(callData);
		if (!exec7702arr) {
			ret.push({funcArr: [], methodIds: ''})
			continue;
		}
		const fnArr: IFuncInfo[] = [];
		for (const exec7702 of exec7702arr) {
			const {dest, value, func} = exec7702;
			const destId = await makeIdV(dest, null, {dt: blockTime});
			fnArr.length < COUNT_AA_TX_METHODS && fnArr.push({
				dest, func: func.substring(0, 10), destId,

			});
		}
		const methodIds = fnArr.map(fn=>`${fn.destId}:${fn.func}`).join(',');
		ret.push({funcArr: fnArr, methodIds});
	}

	return ret;
}

export function testParse4337Func(hex: string) {
	// printInterfaceMethods(entryPointV8);
	// printInterfaceMethods(iface7702.format());
	const {abi: abi20} = require('../../service/watcher/contract/miniERC20.json');
	const iErc20 = new ethers.Interface(abi20)
	const arr = parseHandleOps(hex);
	if (!arr?.length) {
		console.log(`no handleOps found`);
		return null;
	}
	for (let i = 0; i < arr.length; i++) {
		const {callData} = arr[i];
		const exec7702arr = parse7702execute(callData);
		if (!exec7702arr) {
			console.log(`no exec7702 found with callData: ${callData}`);
			continue;
		}
		for (const exec7702 of exec7702arr) {
			const {dest, value, func} = exec7702;
			let fn = func;
			if (func.length > 10) {
				const erc20params = iErc20.parseTransaction({data: func});
				fn = erc20params?.name || fn;
			}
			console.log(`exec7702, dest ${dest} value: ${formatEther(value)} func: ${fn}`);
		}
	}
}
