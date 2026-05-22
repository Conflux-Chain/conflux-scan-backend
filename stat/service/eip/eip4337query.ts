// Query result interfaces with joined data
import {AATx, BundleTx, IAATx, IBundleTx, UserOperationRevertReason} from "../../model/eip4337model";
import {Hex40Map, idHex40Map} from "../../model/HexMap";
import {IPageParam} from "../../router/ParamChecker";
import {ethers} from "ethers";
import {Sequelize} from "sequelize";
import {FailedTx, FullTransaction} from "../../model/FullBlock";
import {Literal} from "sequelize/lib/utils";
import {fillMethodInfo} from "../contract/contractTool";
import {parseBundleTxByHash} from "./eip4337bundleParser";
import {Conflux} from "js-conflux-sdk";

export interface BundleTxQueryResult extends IBundleTx {
    bundlerHex: string;      // hex address from Hex40Map
    entryPointHex: string;   // hex address from Hex40Map
}

export interface AATxQueryResult extends IAATx {
    senderHex: string;       // hex address from Hex40Map
    bundlerHex: string;      // hex address from Hex40Map
    entryPointHex: string;   // hex address from Hex40Map
    txHash?: string;         // bundle tx hash (from joined BundleTx)
    failedReason?: string;
    // deep fields — populated only by getAATxDetail
    verificationGasLimit?: string;
    preVerificationGas?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    signature?: string;
    txGasLimit?: string;
    txGasUsed?: string;
    [key: string]: any;      // allow dynamic extra fields
}

// Query parameters interfaces
export interface BundleTxQueryParams extends IPageParam {
    bundlerId?: number;
    entryPointId?: number;
}

export interface AATxQueryParams extends IPageParam{
    senderId?: number;
    bundlerId?: number;
    entryPointId?: number;
    userOpHash?: string;
}

let cachedErrMsgLiteral: Literal = null;
function buildErrMsgSql(): Literal {
    if (cachedErrMsgLiteral) {
        return cachedErrMsgLiteral;
    }
    const txT = FullTransaction.getTableName().toString();
    const errMsgT = FailedTx.getTableName().toString();

    cachedErrMsgLiteral = Sequelize.literal(`(
                    SELECT CASE 
                        WHEN status = 1 THEN (
                            SELECT txExecErrorMsg 
                            FROM ${errMsgT} ft
                            INNER JOIN ${txT} ftt ON ftt.epoch = ft.epoch 
                                AND ftt.blockPosition = ft.blockPosition 
                                AND ftt.txPosition = ft.txPosition
                            WHERE ftt.hash = BundleTx.hash
                            LIMIT 1
                        )
                        ELSE NULL
                    END
                )`);
    return cachedErrMsgLiteral;
}

/**
 * Query BundleTx with optional filters for bundlerId and entryPointId (AND relationship)
 * @param params - Query parameters with optional bundlerId and entryPointId
 * @returns Array of BundleTx with resolved hex addresses for bundler and entryPoint
 */
export async function queryBundleTx(params: BundleTxQueryParams): Promise<{ total: number, list:BundleTxQueryResult[] }> {
    const whereClause: any = {};

    if (params.bundlerId !== undefined) {
        whereClause.bundlerId = params.bundlerId;
    }
    if (params.entryPointId !== undefined) {
        whereClause.entryPointId = params.entryPointId;
    }

    const {rows: results, count} = await BundleTx.findAndCountAll({
        where: whereClause,
        include: [
            {
                model: Hex40Map,
                as: 'bundler',
                attributes: ['hex'],
                required: false, // LEFT JOIN to include records even if hex mapping missing
            },
            {
                model: Hex40Map,
                as: 'entryPoint',
                attributes: ['hex'],
                required: false,
            }
        ],
        attributes: {
            include: [
                [
                    buildErrMsgSql(),
                    'errMsg'
                ]
            ]
        },
        order: [['epoch', 'DESC'], ['id', 'DESC']],
        offset: params.skip, limit: params.limit,
        raw: false,
    });

    const list = results.map(bundle => {
        const row = {
            ...bundle.toJSON(),
            bundlerHex: pickAddr('bundler', bundle),
            entryPointHex: pickAddr('entryPoint', bundle),
        };
        delete row.entryPointId;
        delete row.bundlerId;
        delete row['bundler'];
        delete row['entryPoint'];
        delete row['updatedAt'];
        return row;
    });

    return {total: count, list};
}

/**
 * Query AATx with optional filters for senderId, bundlerId, entryPointId (AND relationship)
 * @param params - Query parameters with optional senderId, bundlerId, entryPointId
 * @returns Array of AATx with resolved hex addresses for sender, bundler and entryPoint
 */
export async function queryAATx(params: AATxQueryParams): Promise<{ list: AATxQueryResult[], total: number }> {
    const whereClause: any = {};

    if (params.userOpHash !== undefined) {
        whereClause.userOpHash = params.userOpHash;
    }
    if (params.senderId !== undefined) {
        whereClause.senderId = params.senderId;
    }
    if (params.bundlerId !== undefined) {
        whereClause.bundlerId = params.bundlerId;
    }
    if (params.entryPointId !== undefined) {
        whereClause.entryPointId = params.entryPointId;
    }

    const {rows: results, count} = await AATx.findAndCountAll({
        where: whereClause,
        include: [
            {
                model: Hex40Map,
                as: 'sender',
                attributes: ['hex'],
                required: false, // LEFT JOIN to include records even if hex mapping missing
            }, {
                model: Hex40Map,
                as: 'bundler',
                attributes: ['hex'],
                required: false,
            }, {
                model: Hex40Map,
                as: 'entryPoint',
                attributes: ['hex'],
                required: false,
            }, {
                model: BundleTx,
                as: 'bundleTx', attributes: ['hash', 'status'],
                required: false,
            }
        ],
        order: [['epoch', 'DESC'], ['id', 'DESC']],
        offset: params.skip, limit: params.limit,
        raw: false,
    });

    const list = [];
    for (const aaTx of results) {
        const row = {
            ...aaTx.toJSON(),
            senderHex: pickAddr('sender', aaTx),
            bundlerHex: pickAddr('bundler', aaTx),
            entryPointHex: pickAddr('entryPoint', aaTx),
            // @ts-ignore
            txHash: aaTx.get("bundleTx")?.hash,
            failedReason: await fillRevertReason(aaTx),
        };
        delete row.entryPointId;
        delete row.bundlerId;
        delete row.bundleTxId;
        delete row.paymasterId;
        delete row['entryPoint'];
        delete row['updatedAt'];
        delete row['senderId'];
        delete row['sender'];
        delete row['bundleTx'];
        delete row['eventContractId'];
        delete row['bundler'];

        // rename DB column method7702 → method in API response
        row['method'] = row['method7702'];
        delete row['method7702'];

        list.push(row);
    }
    return {list, total: count};
}

async function fillRevertReason(row: IAATx & any) : Promise<string> {
    if (row.success) {
        return '';
    }
    const bundleTx = row.get('bundleTx') as BundleTx;
    if (!bundleTx) {
        return 'BundleTx not found';
    }
    let failedReason = ''
    if (bundleTx.status === 1) {
        failedReason = 'Bundle TX failed'
    } else {
        const revertReason = await UserOperationRevertReason.findOne({
            where: {userOpHash: row.userOpHash, epoch: row.epoch}, raw: true,
        })
        failedReason = revertReason?.revertReason || 'unknown';
    }
    return failedReason;
}

const pickAddr = (key: string, bundle: BundleTx|AATx) => {
    // @ts-ignore
    const v = bundle.get(key)?.hex;
    return v ? ethers.getAddress('0x' + v) : '';
}

/**
 * Parse the packed AATx.methods string into individual (contractId, methodHash) pairs.
 * Format: "hex40mapId:methodHash,hex40mapId:methodHash,..."
 */
function parseMethodsField(methods: string): {contractId: number; methodHash: string}[] {
    if (!methods) return [];
    return methods.split(',').map(part => {
        const sep = part.indexOf(':');
        if (sep < 1) return null;
        const contractId = parseInt(part.slice(0, sep));
        const methodHash = part.slice(sep + 1);
        if (!contractId || !methodHash) return null;
        return {contractId, methodHash};
    }).filter(Boolean);
}

/**
 * Resolve the raw AATx.methods field (format: "hex40mapId:methodHash,...") to
 * human-readable names via fillMethodInfo. Mutates each item in the list,
 * keeping the original string in `methods` and adding a new `parsedMethods` array:
 *   [{to, method, methodId}]
 * where `method` is the resolved name and `methodId` is the original 4-byte hash.
 */
export async function fillAATxMethodInfo(list: any[]): Promise<void> {
    const flatList: {method: string; to: string}[] = [];
    const toIdArr: number[] = [];
    const itemFlatIndices: number[][] = list.map(() => []);

    const allContractIds = new Set<number>();
    list.forEach(item => {
        parseMethodsField(item.methods).forEach(({contractId}) => allContractIds.add(contractId));
    });

    if (allContractIds.size === 0) {
        list.forEach(item => { item.parsedMethods = []; });
        return;
    }

    const idToHex = await idHex40Map([...allContractIds], true);

    list.forEach((item, listIdx) => {
        parseMethodsField(item.methods).forEach(({contractId, methodHash}) => {
            itemFlatIndices[listIdx].push(flatList.length);
            flatList.push({method: methodHash, to: idToHex.get(contractId) || ''});
            toIdArr.push(contractId);
        });
    });

    await fillMethodInfo(flatList, toIdArr, true).catch(err => {
        console.error('fillAATxMethodInfo error:', err);
    });

    list.forEach((item, listIdx) => {
        item.parsedMethods = itemFlatIndices[listIdx].map(fi => {
            const entry = flatList[fi] as any;
            return {to: entry.to, method: entry.method, methodId: entry.methodId};
        });
    });
}

/**
 * Fetch a single AA tx by userOpHash from the DB, enrich with resolved method names,
 * and deep-parse extra gas/signature fields from the bundle tx.
 * Returns null if not found.
 */
export async function getAATxDetail(cfx: Conflux, userOpHash: string): Promise<AATxQueryResult | null> {
    const result = await queryAATx({userOpHash, skip: 0, limit: 1});
    if (!result.list.length) return null;

    await fillAATxMethodInfo(result.list);
    const aaTx = result.list[0];

    const bundleTxHash = aaTx.txHash;
    if (bundleTxHash) {
        const parsed = await parseBundleTxByHash(cfx, bundleTxHash, {targetUserOpHash: userOpHash});
        const matchedOp = parsed?.userOps.find(op => op.userOpHash === userOpHash);
        if (matchedOp) {
            Object.assign(aaTx, {
                verificationGasLimit:    matchedOp.verificationGasLimit,
                preVerificationGas:      matchedOp.preVerificationGas,
                callGasLimit:            matchedOp.gasLimit,
                maxFeePerGas:            matchedOp.maxFeePerGas,
                maxPriorityFeePerGas:    matchedOp.maxPriorityFeePerGas,
                signature:               matchedOp.signature,
                txGasLimit:              matchedOp.txGasLimit,
                txGasUsed:               matchedOp.txGasUsed,
                data:                    matchedOp.callData ?? null,
                position:                matchedOp.position,
                paymasterAndData:        matchedOp.paymasterAndData ?? '0x',
                paymasterDecoded:        matchedOp.paymasterDecoded ?? null,
                bundleEffectiveGasPrice: matchedOp.bundleEffectiveGasPrice ?? '0',
                actualGasUsed:           matchedOp.actualGasUsed,
            });
        }
    }
    return aaTx;
}

