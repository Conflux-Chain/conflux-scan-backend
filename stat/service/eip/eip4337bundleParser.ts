import {ethers, formatEther} from "ethers";
import {Conflux, format} from "js-conflux-sdk";
import {parseAATxMethods, getPaymasterAddress, readOpHash} from "./eip4337decoder";
import {parseUserOperationEvent} from "./eip4337abi";
import {AATx, BundleTx} from "../../model/eip4337model";

const {tracesInTree} = require('js-conflux-sdk/src/util/trace');

const TRANSFER_SIG = ethers.id("Transfer(address,address,uint256)");
const TRANSFER_SINGLE_SIG = ethers.id("TransferSingle(address,address,address,uint256,uint256)");
const TRANSFER_BATCH_SIG = ethers.id("TransferBatch(address,address,address,uint256[],uint256[])");
const USER_OPERATION_EVENT_SIG = ethers.id("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");

export interface IAAOpDetail {
	userOpHash: string;
	/** EIP-7702 execution method (e.g. execute, executeBatch). Empty if not applicable. */
	method: string;
	/** Zero-based index of this user op within the bundle. */
	position: number;
	/** Sender (smart account) address in checksum hex format. */
	from: string;
	/**
	 * Number of internal executions decoded from the user op callData.
	 * `execute` = 1, `executeBatch` = N (the actual array length), 0 if not decoded.
	 */
	internalTxnCount: number;
	/** Number of ERC-20 token transfer events attributed to this user op. */
	tokenTxnCount: number;
	/** Number of ERC-721 / ERC-1155 transfer events attributed to this user op. */
	nftTxnCount: number;
	/** Actual gas cost paid for this user op, in ETH (decimal string). */
	txnFee: string;
	/** callGasLimit for this user op (decimal string). Low 128 bits of accountGasLimits. */
	gasLimit: string;
	/** Actual gas units consumed by this user op (decimal string), from UserOperationEvent. */
	actualGasUsed: string;
	success: boolean;
	nonce: string;
	/** Paymaster address. Empty string if none. */
	paymaster: string;

	// --- deep fields (populated only when parseBundleTxByHash is called with deep=true) ---
	/** verificationGasLimit for this user op (decimal string). High 128 bits of accountGasLimits. */
	verificationGasLimit?: string;
	/** preVerificationGas for this user op (decimal string). */
	preVerificationGas?: string;
	/** maxFeePerGas in wei (decimal string). Low 128 bits of gasFees. */
	maxFeePerGas?: string;
	/** maxPriorityFeePerGas in wei (decimal string). High 128 bits of gasFees. */
	maxPriorityFeePerGas?: string;
	/** Raw signature bytes (hex string). */
	signature?: string;
	/** Bundle tx gas limit (decimal string). */
	txGasLimit?: string;
	/** Bundle tx gas used from receipt (decimal string). */
	txGasUsed?: string;
	/** Raw callData of this user op (hex string). */
	callData?: string;
	/** initCode for account deployment — non-empty only on first user op (hex string). */
	initCode?: string;
	/** Raw paymasterAndData field from the user op (hex string). */
	paymasterAndData?: string;
	/** Decoded paymaster info. Null if no paymaster. */
	paymasterDecoded?: { address: string } | null;
	/** paymasterVerificationGasLimit from paymasterAndData (decimal string). */
	paymasterVerificationGasLimit?: string;
	/** paymasterPostOpGasLimit from paymasterAndData (decimal string). */
	paymasterPostOpGasLimit?: string;
	/** Effective gas price of the bundle tx in wei (decimal string). */
	bundleEffectiveGasPrice?: string;
	/** Raw packed accountGasLimits bytes32 field from the user op (hex string). */
	accountGasLimits?: string;
}

export interface IBundleTxParseResult {
	hash: string;
	/** EntryPoint method name (e.g. handleOps). */
	method: string;
	/** Bundler address (checksummed hex). */
	from: string;
	/** EntryPoint contract address (checksummed hex). */
	to: string;
	/** 0 = success, 1 = failure (matching existing convention). */
	status: number;
	/** Total gas fee for the bundle tx, in ETH (decimal string). */
	txnFee: string;
	/** Block/epoch number. */
	blockNumber: number;
	/** Block timestamp in seconds (Unix). */
	timestamp: number;
	userOps: IAAOpDetail[];
	/** Raw transaction object from cfx.getTransactionByHash. */
	tx: any;
	/** Raw receipt object from cfx.getTransactionReceipt. */
	receipt: any;
}

function toChecksumHex(addr: string): string {
	if (!addr) return '';
	return ethers.getAddress(format.hexAddress(addr));
}

/**
 * Build IAAOpDetail entries for a failed bundle where no UserOperationEvent logs were emitted.
 * Falls back to the parsed calldata, marking all ops as failed with zero gas used.
 */
async function buildFailedUserOps(
	cfx: Conflux,
	entryPoint: string,
	parsed4337call: ReturnType<typeof parseAATxMethods>,
): Promise<IAAOpDetail[]> {
	const result: IAAOpDetail[] = [];
	for (let i = 0; i < parsed4337call.userOps.length; i++) {
		const parsedOp = parsed4337call.userOps[i];
		const gasLimit = parsedOp.isV6
			? parsedOp.callGasLimit?.toString() ?? '0'
			: unpackBytes32(parsedOp.accountGasLimits).low;
		result.push({
			userOpHash: await readOpHash(cfx, entryPoint, parsedOp.rawData),
			method: parsedOp.parsedUserOp?.method ?? '',
			position: i,
			from: toChecksumHex(parsedOp.sender),
			internalTxnCount: parsedOp.parsedUserOp?.rawParamArr?.length ?? 0,
			tokenTxnCount: 0,
			nftTxnCount: 0,
			txnFee: '0',
			gasLimit,
			actualGasUsed: '0',
			success: false,
			nonce: parsedOp.nonce?.toString() ?? '',
			paymaster: toChecksumHex(getPaymasterAddress(parsedOp.paymasterAndData)),
		});
	}
	return result;
}


/**
 * Count ERC-20 and NFT transfer events in a set of logs.
 * ERC-20 Transfer: same sig as ERC-721 but only 3 topics (from/to not indexed for tokenId).
 * ERC-721 Transfer: 4 topics (from, to, tokenId all indexed).
 * ERC-1155 TransferSingle / TransferBatch.
 */
function countTransfers(logs: any[]): {tokenTxnCount: number; nftTxnCount: number} {
	let tokenTxnCount = 0;
	let nftTxnCount = 0;
	for (const log of logs) {
		const topics: string[] = log.topics || [];
		const sig = topics[0];
		if (!sig) continue;
		if (sig === TRANSFER_SIG) {
			if (topics.length === 3) tokenTxnCount++;
			else if (topics.length === 4) nftTxnCount++;
		} else if (sig === TRANSFER_SINGLE_SIG || sig === TRANSFER_BATCH_SIG) {
			nftTxnCount++;
		}
	}
	return {tokenTxnCount, nftTxnCount};
}


/**
 * Unpack a bytes32 field into two 128-bit values.
 * Returns { high, low } as decimal strings.
 */
function unpackBytes32(packed: string): { high: string; low: string } {
	try {
		let hex = (packed ?? '').startsWith('0x') ? packed.slice(2) : (packed ?? '');
		hex = hex.padStart(64, '0');
		return {
			high: BigInt('0x' + hex.slice(0, 32)).toString(),
			low:  BigInt('0x' + hex.slice(32, 64)).toString(),
		};
	} catch {
		return { high: '0', low: '0' };
	}
}


function normalizeTxAddresses(tx: any): any {
	if (!tx) return tx;
	return {
		...tx,
		from: toChecksumHex(tx.from) || tx.from,
		to: toChecksumHex(tx.to) || tx.to,
	};
}

function normalizeReceiptAddresses(receipt: any): any {
	if (!receipt) return receipt;
	return {
		...receipt,
		from: toChecksumHex(receipt.from) || receipt.from,
		to: toChecksumHex(receipt.to) || receipt.to,
	};
}

/**
 * Parse a bundle transaction by hash using the Conflux SDK.
 *
 * Fetches the transaction and receipt, parses the handleOps calldata and
 * receipt logs, and returns structured per-user-op details.
 *
 * Returns null if the tx is not found or is not a recognised 4337 bundle.
 */
export async function parseBundleTxByHash(
	cfx: Conflux,
	txHash: string,
	options?: { targetUserOpHash?: string },
): Promise<IBundleTxParseResult | null> {
	const [tx, receipt] = await Promise.all([
		cfx.getTransactionByHash(txHash),
		cfx.getTransactionReceipt(txHash),
	]);

	if (!tx || !receipt) {
		return null;
	}

	const parsed4337call = parseAATxMethods(tx.data || '0x', format.hexAddress(tx.to));
	if (!parsed4337call) {
		return null;
	}

	const logs: any[] = receipt.logs || [];

	// Locate positions of UserOperationEvent logs – they mark the end of each user op.
	const userOpEventIndices: number[] = [];
	for (let i = 0; i < logs.length; i++) {
		if ((logs[i].topics as string[])?.[0] === USER_OPERATION_EVENT_SIG) {
			userOpEventIndices.push(i);
		}
	}

	// Slice logs between consecutive UserOperationEvent entries.
	// Logs *before* event[i] belong to user op i.
	const userOpLogGroups: any[][] = [];
	let prevIdx = 0;
	for (const eventIdx of userOpEventIndices) {
		userOpLogGroups.push(logs.slice(prevIdx, eventIdx));
		prevIdx = eventIdx + 1;
	}

	const targetUserOpHash = options?.targetUserOpHash;
	const userOps: IAAOpDetail[] = [];

	for (let i = 0; i < userOpEventIndices.length; i++) {
		const eventLog = logs[userOpEventIndices[i]];
		const event = parseUserOperationEvent(eventLog);
		const innerLogs = userOpLogGroups[i] || [];
		const {tokenTxnCount, nftTxnCount} = countTransfers(innerLogs);

		const parsedUserOp = parsed4337call.userOps[i];
		const gasLimit = parsedUserOp?.isV6
			? parsedUserOp.callGasLimit?.toString() ?? '0'
			: unpackBytes32(parsedUserOp?.accountGasLimits).low;  // low 128 bits = callGasLimit
		const method = parsedUserOp?.parsedUserOp?.method ?? '';
		const internalTxnCount = parsedUserOp?.parsedUserOp?.rawParamArr?.length ?? 0;
		const sender = toChecksumHex(event?.sender);
		const paymaster = toChecksumHex(event?.paymaster);
		const opHash = event?.userOpHash ?? '';

		const op: IAAOpDetail = {
			userOpHash: opHash,
			method,
			position: i,
			from: sender,
			internalTxnCount,
			tokenTxnCount,
			nftTxnCount,
			txnFee: event ? formatEther(event.actualGasCost) : '0',
			gasLimit,
			actualGasUsed: event?.actualGasUsed?.toString() ?? '0',
			success: event?.success ?? false,
			nonce: event?.nonce?.toString() ?? '',
			paymaster,
		};

		// Deep-parse extra fields only for the target user op.
		if (targetUserOpHash && opHash === targetUserOpHash && parsedUserOp) {
			if (parsedUserOp.isV6) {
				op.verificationGasLimit = parsedUserOp.verificationGasLimit?.toString() ?? '0';
				op.preVerificationGas = parsedUserOp.preVerificationGas?.toString() ?? '0';
				op.maxFeePerGas = parsedUserOp.maxFeePerGas?.toString() ?? '0';
				op.maxPriorityFeePerGas = parsedUserOp.maxPriorityFeePerGas?.toString() ?? '0';
			} else {
				const accountGasLimitsParsed = unpackBytes32(parsedUserOp.accountGasLimits);
				const gasFeesParsed = unpackBytes32(parsedUserOp.gasFees);
				op.verificationGasLimit = accountGasLimitsParsed.high;  // high 128 bits = verificationGasLimit
				op.preVerificationGas = parsedUserOp.preVerificationGas?.toString() ?? '0';
				op.maxFeePerGas = gasFeesParsed.low;
				op.maxPriorityFeePerGas = gasFeesParsed.high;
				op.accountGasLimits = parsedUserOp.accountGasLimits ?? '0x';
			}
			op.signature = parsedUserOp.signature ?? '';
			op.txGasLimit = (tx as any).gas?.toString() ?? '0';
			op.txGasUsed = (receipt as any).gasUsed?.toString() ?? '0';
			op.callData = parsedUserOp.callData ?? '';
			op.initCode = parsedUserOp.initCode ?? '0x';
			op.paymasterAndData = parsedUserOp.paymasterAndData ?? '0x';
			const paymasterAddr = getPaymasterAddress(parsedUserOp.paymasterAndData);
			op.paymasterDecoded = paymasterAddr ? { address: ethers.getAddress(paymasterAddr) } : null;
			// v0.8 paymasterAndData: paymaster(20) + verificationGasLimit(16) + postOpGasLimit(16) + data
			// v0.6 does not embed separate paymaster gas limits
			if (!parsedUserOp.isV6 && paymasterAddr && parsedUserOp.paymasterAndData?.length >= 106) {
				const pmData = parsedUserOp.paymasterAndData.startsWith('0x')
					? parsedUserOp.paymasterAndData.slice(2)
					: parsedUserOp.paymasterAndData;
				op.paymasterVerificationGasLimit = BigInt('0x' + pmData.slice(40, 72)).toString();
				op.paymasterPostOpGasLimit = BigInt('0x' + pmData.slice(72, 104)).toString();
			}
			op.bundleEffectiveGasPrice = ((receipt as any).effectiveGasPrice ?? (tx as any).gasPrice ?? BigInt(0)).toString();
		}

		userOps.push(op);
	}

	// Failed bundle: no UserOperationEvent logs emitted. Build ops from calldata.
	if (userOps.length === 0 && receipt.outcomeStatus !== 0) {
		const failed = await buildFailedUserOps(cfx, format.hexAddress(tx.to), parsed4337call);
		userOps.push(...failed);
	}

	// Fetch block for timestamp.
	const blockHash = (receipt as any).blockHash;
	const block = blockHash ? await cfx.getBlockByHash(blockHash) : null;
	const timestamp = block ? Number(block.timestamp) : 0;

	return {
		hash: txHash,
		method: parsed4337call.method,
		from: toChecksumHex(tx.from),
		to: toChecksumHex(tx.to),
		status: receipt.outcomeStatus === 0 ? 0 : 1,
		txnFee: formatEther(receipt.gasFee ?? 0n),
		blockNumber: Number(receipt.epochNumber),
		timestamp,
		userOps,
		tx: normalizeTxAddresses(tx),
		receipt: normalizeReceiptAddresses(receipt),
	};
}

/** 4-byte selector of EntryPoint.innerHandleOp */
const INNER_HANDLE_OP_SELECTOR = '0x0042dc53';

/**
 * Look up the bundle transaction hash for a given user op hash.
 * Returns null if the user op is not found.
 */
export async function getBundleTxHashForUserOp(userOpHash: string): Promise<string | null> {
	const aaTx = await AATx.findOne({
		where: { userOpHash },
		include: [{ model: BundleTx, as: 'bundleTx', attributes: ['hash'], required: true }],
		raw: false,
	});
	// @ts-ignore
	return aaTx?.get('bundleTx')?.hash ?? null;
}

/**
 * Find the position (0-based index) of a user op in its bundle by scanning
 * the UserOperationEvent logs in the receipt.
 * Returns -1 if not found.
 */
export async function getAAOpPositionInBundle(cfx: Conflux, bundleTxHash: string, userOpHash: string, cachedReceipt?: any): Promise<number> {
	const receipt = cachedReceipt ?? await cfx.getTransactionReceipt(bundleTxHash);
	const logs: any[] = (receipt as any)?.logs ?? [];
	let position = 0;
	for (const log of logs) {
		if ((log.topics as string[])?.[0] !== USER_OPERATION_EVENT_SIG) continue;
		const event = parseUserOperationEvent(log);
		if (event?.userOpHash === userOpHash) return position;
		position++;
	}
	return -1;
}

/**
 * Return the transactionLogIndex range (startExclusive, endInclusive] for the
 * user op at the given position within a bundle tx.
 *
 * The range is delimited by UserOperationEvent logs: logs for op N are those
 * with logIndex > (N-1)-th UserOperationEvent logIndex (or -1 if N=0)
 * and <= N-th UserOperationEvent logIndex.
 *
 * UserOperationRevertReason (emitted before UserOperationEvent on failure) is
 * naturally included since it falls within the same range.
 *
 * Returns null if the position is out of range.
 */
export async function getAAOpLogRange(
	cfx: Conflux,
	bundleTxHash: string,
	position: number,
	cachedReceipt?: any,
): Promise<{ startExclusive: number; endInclusive: number } | null> {
	const receipt = cachedReceipt ?? await cfx.getTransactionReceipt(bundleTxHash);
	const logs: any[] = (receipt as any)?.logs ?? [];
	let opIdx = 0;
	let prevEventLogIndex = -1;
	for (let i = 0; i < logs.length; i++) {
		if ((logs[i].topics as string[])?.[0] !== USER_OPERATION_EVENT_SIG) {
			continue;
		}
		if (opIdx === position) {
			return { startExclusive: prevEventLogIndex, endInclusive: i };
		}
		prevEventLogIndex = i;
		opIdx++;
	}
	return null;
}

/**
 * Recursively flatten a trace tree node back into a DFS-ordered flat trace array,
 * stripping the `calls` children array from each node.
 */
function flattenTraceNode(node: any): any[] {
	if (!node) {
		return [];
	}
	const {calls, ...trace} = node;
	return [trace, ...(calls ?? []).flatMap((c: any) => flattenTraceNode(c))];
}

/**
 * Fetch the bundle tx trace, extract the subtree for the user op at the given
 * position, and return it as a flat DFS-ordered trace array suitable for
 * TransactionService.buildCfxTransfersFromTraceObj.
 *
 * Returns an empty array if the position is out of range.
 */
export async function getAAOpFlatTraces(cfx: Conflux, bundleTxHash: string, position: number): Promise<any[]> {
	const rawTraces = await (cfx as any).traceTransaction(bundleTxHash);
	if (!rawTraces?.length) {
		return [];
	}
	const traceTree: any[] = tracesInTree(rawTraces);
	const opNode = extractAAOpTraceNode(traceTree, position);
	if (!opNode) {
		return [];
	}
	return flattenTraceNode(opNode);
}

/**
 * Extract the trace subtree for the N-th user op from a bundle tx trace tree.
 *
 * EIP-4337: the EntryPoint calls innerHandleOp (from=EP, to=EP, input starts with
 * INNER_HANDLE_OP_SELECTOR) once per user op, in order, after all validation calls.
 * The N-th such self-call node corresponds to user op at position N.
 *
 * @param traceTree  The traceTree array returned by ConfluxService.getTransactionTrace.
 * @param position   Zero-based index of the target user op in the bundle.
 * @returns The innerHandleOp call node, or null if not found.
 */
export function extractAAOpTraceNode(traceTree: any[], position: number): any | null {
	const rootCalls: any[] = traceTree?.[0]?.calls ?? [];
	let count = 0;
	for (const call of rootCalls) {
		const from: string = call.action?.from ?? '';
		const to: string   = call.action?.to ?? '';
		const input: string = call.action?.input ?? '';
		if (from.toLowerCase() === to.toLowerCase() && input.startsWith(INNER_HANDLE_OP_SELECTOR)) {
			if (count === position) return call;
			count++;
		}
	}
	return null;
}
