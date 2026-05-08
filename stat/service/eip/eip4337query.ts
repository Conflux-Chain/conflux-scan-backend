// Query result interfaces with joined data
import {AATx, BundleTx, IAATx, IBundleTx} from "../../model/eip4337model";
import {Hex40Map} from "../../model/HexMap";
import {IPageParam} from "../../router/ParamChecker";
import {ethers} from "ethers";

export interface BundleTxQueryResult extends IBundleTx {
    bundlerHex: string;      // hex address from Hex40Map
    entryPointHex: string;   // hex address from Hex40Map
}

export interface AATxQueryResult extends IAATx {
    senderHex: string;       // hex address from Hex40Map
    bundlerHex: string;      // hex address from Hex40Map
    entryPointHex: string;   // hex address from Hex40Map
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
                as: 'bundleTx', attributes: ['hash'],
                required: false,
            }
        ],
        order: [['epoch', 'DESC'], ['id', 'DESC']],
        offset: params.skip, limit: params.limit,
        raw: false,
    });

    const list = results.map(aaTx => {
        const row = {
            ...aaTx.toJSON(),
            senderHex: pickAddr('sender', aaTx),
            bundlerHex: pickAddr('bundler', aaTx),
            entryPointHex: pickAddr('entryPoint', aaTx),
            // @ts-ignore
            txHash: aaTx.get("bundleTx")?.hash,
        };
        delete row.entryPointId;
        delete row.bundlerId;
        delete row.bundleTxId;
        delete row.paymasterId;
        delete row['bundler'];
        delete row['entryPoint'];
        delete row['updatedAt'];
        delete row['senderId'];
        delete row['sender'];
        delete row['bundleTx'];
        delete row['eventContractId'];
        return row;
    });
    return {list, total: count};
}


const pickAddr = (key: string, bundle: BundleTx|AATx) => {
    // @ts-ignore
    const v = bundle.get(key)?.hex;
    return v ? ethers.getAddress('0x' + v) : '';
}
