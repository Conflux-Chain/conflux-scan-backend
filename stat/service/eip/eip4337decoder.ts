import {ethers, formatEther} from "ethers";
import {entryPointV8} from "./entryPointV8.json";
import {makeIdV} from "../../model/HexMap";

const iface = new ethers.Interface(entryPointV8);

export interface IUserOpParam {
	callData: string;
	accountGasLimits: string;

	parsedUserOp: IParsed7702Param;
}
export interface IParsed7702Param {
	//7702 method
	method: string;
	rawParamArr: ExecuteParams[];
	callArr: IAAInternalTxCall[];
	methodIds: string;
}

export interface I4337call {
	method: string;
	userOps: IUserOpParam[];
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

export function parseHandleOps(callData: string): I4337call {
	const decoded = iface.parseTransaction({ data: callData });
	if (!decoded) {
		return null;
	}
	const [ops, beneficiary] = decoded.args;
	const userOpArr: IUserOpParam[] = [];
	for (const op of ops) {
		const {callData, accountGasLimits,} = op;
		userOpArr.push({
			callData, accountGasLimits,
			parsedUserOp: parse7702execute(callData)
		});
	}
	return {
		method: decoded.name,
		userOps: userOpArr,
	};
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

function parse7702execute(callData: string): IParsed7702Param {
	const decode = iface7702.parseTransaction({ data: callData });
	if (!decode) {
		return null;
	}
	let ret: IParsed7702Param;
	if (decode.name === 'executeBatch') {
		const [rows] = decode.args;
		const paramArr = [];
		for (let i = 0; i < rows.length; i++) {
			const [dest, value, func] = rows[i];
			paramArr.push({dest, value, func});
		}
		ret = {method: decode.name, rawParamArr: paramArr} as IParsed7702Param;
	} else {
		const [dest, value, func] = decode.args;
		ret = {method: decode.name, execArr: [{dest, value, func}]} as unknown as IParsed7702Param;
	}

	return ret;
}

export interface IAAInternalTxCall {
	dest: string;
	destId: number;
	func: string;
	value: bigint;
}

export function parseAATxMethods(hex4337data: string): I4337call {
	const i4337call = parseHandleOps(hex4337data);
	if (!i4337call) {
		return null;
	}
	const arr = i4337call.userOps;
	if (!arr?.length) {
		return i4337call;
	}

	for (let i = 0; i < arr.length; i++) {
		const iUserOpParam: IUserOpParam = arr[i];
		const {callData} = iUserOpParam;
		const parsedUserOp = parse7702execute(callData);
		iUserOpParam.parsedUserOp = parsedUserOp;

		const raw7702ParamArr = parsedUserOp.rawParamArr;
		parsedUserOp.callArr = [];
		if (!raw7702ParamArr) {
			parsedUserOp.methodIds = '';
			continue;
		}
		for (const param of raw7702ParamArr) {
			const {dest, value, func} = param;
			parsedUserOp.callArr.push({
				dest, destId: 0, func: func.substring(0, 10), value: value,
			})
		}

		// parsedUserOp.methodIds = exec7702arr.map(fn => `${fn.destId}:${fn.func}`).join(',');
	}

	return i4337call;
}

export function testParse4337Func(hex: string) {
	// printInterfaceMethods(entryPointV8);
	// printInterfaceMethods(iface7702.format());
	const {abi: abi20} = require('../../service/watcher/contract/miniERC20.json');
	const iErc20 = new ethers.Interface(abi20)
	const i4337call = parseAATxMethods(hex);
	const arr = i4337call?.userOps;
	if (!arr?.length) {
		console.log(`no handleOps found`);
		return null;
	}
	console.log(`call 4337 ${i4337call.method}`);
	for (let i = 0; i < arr.length; i++) {
		const {callData, parsedUserOp} = arr[i];
		const indent = "\t";
		const exec7702arr = parsedUserOp.rawParamArr;
		if (!exec7702arr) {
			console.log(`${indent} no exec7702 found with callData: ${callData}`);
			continue;
		}
		console.log(`${indent} call 7702 ${parsedUserOp.method}`);
		for (const exec7702 of exec7702arr) {
			const {dest, value, func} = exec7702;
			let fn = func;
			if (func.length >= 10) {
				const erc20params = iErc20.parseTransaction({data: func});
				fn = erc20params?.name || fn;
			}
			console.log(`${indent} ${indent} dest ${dest} value: ${formatEther(value)} func: ${fn}`);
		}
	}
}
