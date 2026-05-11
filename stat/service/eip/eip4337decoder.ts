import {BigNumberish, ethers, formatEther} from "ethers";
import {entryPointV8} from "./entryPointV8.json";
import {makeIdV} from "../../model/HexMap";
import {LEN_AA_TX_METHODS} from "../../model/eip4337model";
import {getCfxSdk} from "../common/utils";
import {Conflux, Contract, format} from "js-conflux-sdk";

const iface = new ethers.Interface(entryPointV8);

export interface IUserOpParam {
	rawData: any;

	sender: string;
	nonce: BigNumberish;
	paymasterAndData: string;
	callData: string;
	accountGasLimits: string;

	parsedUserOp: IParsed7702Param;
}
export interface IParsed7702Param {
	//7702 method
	method: string;
	rawParamArr: ExecuteParams[];
	callArr: IAAInternalTxCall[];
}

export interface I4337call {
	method: string;
	userOps: IUserOpParam[];
}

export async function build7702methodIds(parsed7702call: IParsed7702Param, blockTime: Date) : Promise<string> {
	if (parsed7702call) {
		for (const aaInterTx of parsed7702call.callArr) {
			aaInterTx.destId = await makeIdV(aaInterTx.dest, null, {dt: blockTime});
		}
		let method = parsed7702call.callArr
		.map(call=>`${call.destId}:${call.func}`)
		.join(',');
		while (method.length >= LEN_AA_TX_METHODS) {
			const lastPos = method.lastIndexOf(',');
			method = method.substring(0, lastPos);
		}
		return method;
	}
	return ''
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
		const {callData, nonce, paymasterAndData, sender, accountGasLimits,} = op;
		userOpArr.push({
			rawData: op,
			sender, nonce,
			callData, accountGasLimits, paymasterAndData,
			parsedUserOp: null
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
		ret = {method: decode.name, rawParamArr: [{dest, value, func}]} as IParsed7702Param;
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
			continue;
		}
		for (const param of raw7702ParamArr) {
			const {dest, value, func} = param;
			parsedUserOp.callArr.push({
				dest, destId: 0, func: func.substring(0, 10), value: value,
			})
		}

	}

	return i4337call;
}

export async function testParse4337Func(hex: string, to: string) {
	const hexTo = format.hexAddress(to);
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
		const {callData, parsedUserOp, rawData} = arr[i];
		// console.log('raw op data', JSON.stringify(rawData));
		console.log(`entrypoint `, hexTo)
		const opHash = await readOpHash(getCfxSdk(), hexTo, rawData)
		const indent = "\t";
		const exec7702arr = parsedUserOp.rawParamArr;
		if (!exec7702arr) {
			console.log(`${indent} no exec7702 found with callData: ${callData}`);
			continue;
		}
		console.log(`${indent} call 7702 ${parsedUserOp.method} with user op hash ${opHash}`);
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

const contractMap = new Map<string, Contract>();

export async function readOpHash(cfx: Conflux, entryPoint: string, op: any): Promise<string> {
	let contract = contractMap.get(entryPoint);
	if (!contract) {
		contract = new Contract({abi: entryPointV8, address: entryPoint}, cfx);
		contractMap.set(entryPoint, contract);
	}
	return contract['getUserOpHash'](op).then(res=>{
		return ethers.hexlify(res);
	});
}

/**
 * Check if paymasterAndData includes a paymaster (not empty)
 *
 * @param paymasterAndData - The paymasterAndData hex string
 * @returns True if paymaster is present
 */
function hasPaymaster(paymasterAndData: string): boolean {
	return paymasterAndData && paymasterAndData !== '0x' && paymasterAndData.length >= 42;
}

/**
 * Get paymaster address from paymasterAndData
 *
 * @param paymasterAndData - The paymasterAndData hex string
 * @returns Paymaster address or null if not present
 */
export function getPaymasterAddress(paymasterAndData: string): string | null {
	if (!hasPaymaster(paymasterAndData)) {
		return null;
	}

	let hex = paymasterAndData;
	if (hex.startsWith('0x')) {
		hex = hex.slice(2);
	}

	const paymasterHex = hex.slice(0, 40);
	return '0x' + paymasterHex;
}

/**
 * Parsed result from accountGasLimits
 */
interface ParsedAccountGasLimits {
	verificationGasLimit: bigint;  // Gas limit for validation (high 128 bits)
	callGasLimit: bigint;          // Gas limit for execution (low 128 bits)
}

/**
 * Parse accountGasLimits bytes32 field
 * The bytes32 contains two uint128 values packed together:
 * - High 128 bits: verificationGasLimit
 * - Low 128 bits: callGasLimit
 *
 * @param accountGasLimits - The bytes32 hex string (e.g., "0x0000000000000000000000000001573d00000000000000000000000000014140")
 * @returns Object containing verificationGasLimit and callGasLimit
 */
function parseAccountGasLimits(accountGasLimits: string): ParsedAccountGasLimits {
	// Remove '0x' prefix if present
	let hex = accountGasLimits;
	if (hex.startsWith('0x')) {
		hex = hex.slice(2);
	}

	// Ensure it's 64 characters (32 bytes)
	hex = hex.padStart(64, '0');

	if (hex.length !== 64) {
		throw new Error(`Invalid accountGasLimits length: expected 64 hex chars, got ${hex.length}`);
	}

	// Split into two 32-character halves (16 bytes each / 128 bits each)
	const verificationGasHex = hex.slice(0, 32);   // High 128 bits
	const callGasLimitHex = hex.slice(32, 64);     // Low 128 bits

	return {
		verificationGasLimit: BigInt('0x' + verificationGasHex),
		callGasLimit: BigInt('0x' + callGasLimitHex)
	};
}
