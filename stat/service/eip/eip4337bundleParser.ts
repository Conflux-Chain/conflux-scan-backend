import {ethers, formatEther} from "ethers";
import {Conflux, format} from "js-conflux-sdk";
import {parseAATxMethods} from "./eip4337decoder";
import {parseUserOperationEvent} from "./eip4337abi";
import {AATx, BundleTx} from "../../model/eip4337model";

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
	/** callGasLimit for this user op (decimal string). */
	gasLimit: string;
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
}

function toChecksumHex(addr: string): string {
	if (!addr) return '';
	return ethers.getAddress(format.hexAddress(addr));
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
 * Extract callGasLimit from the packed bytes32 accountGasLimits field.
 * High 128 bits = verificationGasLimit, low 128 bits = callGasLimit.
 */
function parseCallGasLimit(accountGasLimits: string): string {
	if (!accountGasLimits) return '0';
	try {
		let hex = accountGasLimits.startsWith('0x') ? accountGasLimits.slice(2) : accountGasLimits;
		hex = hex.padStart(64, '0');
		return BigInt('0x' + hex.slice(32, 64)).toString();
	} catch {
		return '0';
	}
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

	const parsed4337call = parseAATxMethods(tx.data || '0x');
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
		const gasLimit = parseCallGasLimit(parsedUserOp?.accountGasLimits);
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
			success: event?.success ?? false,
			nonce: event?.nonce?.toString() ?? '',
			paymaster,
		};

		// Deep-parse extra fields only for the target user op.
		if (targetUserOpHash && opHash === targetUserOpHash && parsedUserOp) {
			const accountGasLimitsParsed = unpackBytes32(parsedUserOp.accountGasLimits);
			const gasFeesParsed = unpackBytes32(parsedUserOp.gasFees);
			op.verificationGasLimit = accountGasLimitsParsed.high;
			op.preVerificationGas = parsedUserOp.preVerificationGas?.toString() ?? '0';
			op.maxFeePerGas = gasFeesParsed.low;
			op.maxPriorityFeePerGas = gasFeesParsed.high;
			op.signature = parsedUserOp.signature ?? '';
			op.txGasLimit = (tx as any).gas?.toString() ?? '0';
			op.txGasUsed = (receipt as any).gasUsed?.toString() ?? '0';
		}

		userOps.push(op);
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
export async function getAAOpPositionInBundle(cfx: Conflux, bundleTxHash: string, userOpHash: string): Promise<number> {
	const receipt = await cfx.getTransactionReceipt(bundleTxHash);
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
): Promise<{ startExclusive: number; endInclusive: number } | null> {
	const receipt = await cfx.getTransactionReceipt(bundleTxHash);
	const logs: any[] = (receipt as any)?.logs ?? [];
	let opIdx = 0;
	let prevEventLogIndex = -1;
	for (let i = 0; i < logs.length; i++) {
		if ((logs[i].topics as string[])?.[0] !== USER_OPERATION_EVENT_SIG) continue;
		if (opIdx === position) {
			return { startExclusive: prevEventLogIndex, endInclusive: i };
		}
		prevEventLogIndex = i;
		opIdx++;
	}
	return null;
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
