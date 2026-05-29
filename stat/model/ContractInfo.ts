import {DataTypes, Model, Sequelize} from "sequelize";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {Interface, keccak256} from "ethers";

export enum SignatureType {
    Function = "function",
    Event = "event",
    Error = "error",
}

export const MaxSignature = 1024;
export const MaxFullFormat = 4096;

export interface IAbiSignature {
    id?: number
    type: string
    fullFormatHash: string
    fullFormat: string
    signature: string
    hash: string
    updatedAt?: Date
}

export class AbiSignature extends Model<IAbiSignature> implements IAbiSignature {
    id?: number
    type: string
    fullFormatHash: string
    fullFormat: string
    signature: string
    hash: string
    updatedAt?: Date

    static register(seq) {
        AbiSignature.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true},
            type: {type: DataTypes.STRING(16), allowNull: false},
            fullFormatHash: {type: DataTypes.STRING(66), allowNull: false},
            fullFormat: {type: DataTypes.STRING(MaxFullFormat), allowNull: false},
            hash: {type: DataTypes.STRING(66), allowNull: false},
            signature: {type: DataTypes.STRING(MaxSignature), allowNull: false},
        }, {
            sequelize: seq, tableName: 'abi_signatures', charset: 'ascii', collate: 'ascii_general_ci',
            indexes: [
                {name: 'idx_type_full_hash', unique: true, fields: [{name: 'type'}, {name: 'fullFormatHash'}]},
                {name: 'idx_type_hash', fields: [{name: 'type'}, {name: 'hash'}]},
            ]
        })
    }
}

export interface IContractAbiSignature {
    id?:number;
    contractId:number;
    abiId: number;
    updatedAt?:Date;
}
export class ContractAbiSignature extends Model<IContractAbiSignature> implements IContractAbiSignature {
    id?:number;
    contractId:number;
    abiId: number;
    updatedAt?:Date;
    static register(seq: Sequelize) {
        ContractAbiSignature.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey:true, autoIncrement: true},
            contractId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            abiId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq, tableName: 'contract_abi_signatures',
            indexes: [{
                name: 'idx_cid', fields:['contractId', 'abiId'], unique:true,
            }],
        })
    }
}

export async function saveAbiSigs(abiObj: any, contractId?: number, dryRun = false) {
    const abi = (typeof abiObj === 'string') ? JSON.parse(abiObj) : abiObj;

    let iFace: Interface;
    try {
        iFace = new Interface(abi);
    } catch (e) {
        console.log(`Failed to parse abi, contract ${contractId}, abi ${abi}`, e);
        throw e;
    }

    const list = [];
    const fragments = [...Object.values(iFace.fragments)];
    for (const fragment of fragments) {
        const type = fragment.type;
        if (type !== SignatureType.Error && type !== SignatureType.Event && type !== SignatureType.Function) {
            continue;
        }

        const signature = fragment.format("sighash");
        const fullFormat = fragment.format("full");

        const abiSig = getSignature(type as SignatureType, signature, fullFormat);
        if (abiSig) {
            list.push(abiSig);
        }
    }

    if (dryRun) {
        console.log("Succeed to parse abi info", list);
        return;
    }

    try {
        await AbiSignature.bulkCreate(list as AbiSignature[], {
            updateOnDuplicate: ['updatedAt'],
        });
        if (contractId) {
            await saveContractAbiSigs(list, contractId);
        }
        console.log(`Succeed to save abi info: ${list.length}`);
    } catch (err) {
        safeAddErrorLog('DB', `bulk-create-abi-info`, err).then();
        console.log("Failed to save abi info", err);
    }
}

export function getSignature(type: SignatureType, signature: string, fullFormat: string): IAbiSignature | null {
    if (signature.length > MaxSignature) {
        console.log(`Abi signature ${signature.length} exceeds max length ${MaxSignature}\n`, signature);
        return null;
    }
    if (fullFormat.length > MaxFullFormat) {
        console.log(`Abi fullFormat ${fullFormat.length} exceeds max length ${MaxFullFormat}\n`, fullFormat);
        return null;
    }

    const hash = keccak256(Buffer.from(signature));
    const fullFormatHash = keccak256(Buffer.from(fullFormat));

    return {
        type,
        fullFormatHash,
        fullFormat,
        hash: type === SignatureType.Event ? hash : hash.substring(0, 10),
        signature,
    };
}

export async function saveContractAbiSigs(list: AbiSignature[], contractId: number) {
    const sigs = await Promise.all(list.map(item => AbiSignature
        .findOne({where: {type: item.type, fullFormatHash: item.fullFormatHash}})
        .then(found => found ? ({contractId, abiId: found.id}) : null)
    ));

    const uniqueSigs = Array.from(
        new Map(
            sigs
                .filter((item): item is {contractId: number, abiId: number} => !!item && item.abiId != null)
                .map(item => [`${item.contractId}:${item.abiId}`, item])
        ).values()
    );

    if (uniqueSigs.length === 0) {
        return;
    }

    return ContractAbiSignature.bulkCreate(uniqueSigs, {ignoreDuplicates: true});
}

export function parseAbiStr(str: string) {
    const jsonArr = JSON.parse(str);
    const iFace = new Interface(jsonArr);
    return iFace.format();
}

export async function saveAbiAnnounce(str: string, epoch: number, dryRun?: boolean) {
    let segments: string | Array<string>;
    try {
        segments = parseAbiStr(str);
    } catch (e) {
        console.log(`failed to parse abi at epoch ${epoch} for ${str}`, e);
        throw e;
    }
    return saveAbiSigs(segments, 0, dryRun);
}
