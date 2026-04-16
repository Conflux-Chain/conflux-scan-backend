// Query result interfaces with joined data
import {AATx, BundleTx, IAATx, IBundleTx} from "../../model/eip4337model";
import {Hex40Map} from "../../model/HexMap";

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
export interface BundleTxQueryParams {
    bundlerId?: bigint;
    entryPointId?: bigint;
}

export interface AATxQueryParams {
    senderId?: number;
    bundlerId?: bigint;
    entryPointId?: bigint;
}

/**
 * Query BundleTx with optional filters for bundlerId and entryPointId (AND relationship)
 * @param params - Query parameters with optional bundlerId and entryPointId
 * @returns Array of BundleTx with resolved hex addresses for bundler and entryPoint
 */
export async function queryBundleTx(params: BundleTxQueryParams): Promise<BundleTxQueryResult[]> {
    const whereClause: any = {};

    if (params.bundlerId !== undefined) {
        whereClause.bundlerId = params.bundlerId;
    }
    if (params.entryPointId !== undefined) {
        whereClause.entryPointId = params.entryPointId;
    }

    const results = await BundleTx.findAll({
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
        raw: false,
    });

    return results.map(bundle => ({
        ...bundle.toJSON(),
        // @ts-ignore
        bundlerHex: bundle.get('bundler')?.hex || '',
        // @ts-ignore
        entryPointHex: bundle.get('entryPoint')?.hex || '',
    }));
}

/**
 * Query AATx with optional filters for senderId, bundlerId, entryPointId (AND relationship)
 * @param params - Query parameters with optional senderId, bundlerId, entryPointId
 * @returns Array of AATx with resolved hex addresses for sender, bundler and entryPoint
 */
export async function queryAATx(params: AATxQueryParams): Promise<AATxQueryResult[]> {
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

    const results = await AATx.findAll({
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
        raw: false,
    });

    return results.map(aaTx => ({
        ...aaTx.toJSON(),
        // @ts-ignore
        senderHex: aaTx.get('sender')?.hex || '',
        // @ts-ignore
        bundlerHex: aaTx.get('bundler')?.hex || '',
        // @ts-ignore
        entryPointHex: aaTx.get('entryPoint')?.hex || '',
    }));
}
