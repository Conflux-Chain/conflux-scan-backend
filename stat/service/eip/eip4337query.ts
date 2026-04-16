// Query result interfaces with joined data
import {AATx, BundleTx, IAATx, IBundleTx} from "../../model/eip4337model";
import {Hex40Map} from "../../model/HexMap";
import {IPageParam} from "../../router/ParamChecker";

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
    bundlerId?: bigint;
    entryPointId?: bigint;
}

export interface AATxQueryParams extends IPageParam{
    senderId?: number;
    bundlerId?: bigint;
    entryPointId?: bigint;
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
            // @ts-ignore
            bundlerHex: '0x' + bundle.get('bundler')?.hex || '',
            // @ts-ignore
            entryPointHex: '0x' + bundle.get('entryPoint')?.hex || '',
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
            },
            {
                model: Hex40Map,
                as: 'bundler',
                attributes: ['hex'],
                required: false,
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

    const list = results.map(aaTx => {
        const row = {
            ...aaTx.toJSON(),
            // @ts-ignore
            senderHex: '0x' + aaTx.get('sender')?.hex || '',
            // @ts-ignore
            bundlerHex: '0x' + aaTx.get('bundler')?.hex || '',
            // @ts-ignore
            entryPointHex: '0x' + aaTx.get('entryPoint')?.hex || '',
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
        return row;
    });
    return {list, total: count};
}
