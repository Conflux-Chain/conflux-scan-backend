import {DataTypes, Model, Sequelize} from "sequelize";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {Interface, keccak256} from "ethers";

export interface IAbiInfo {
    id?:number
    hash:string
    type:string
    fullName:string
    formatWithArg?: string
    updatedAt?:Date
}
export const MaxFullName = 1024;
export const FormatWithArgMaxLength = 4096;
export class AbiInfo extends Model<IAbiInfo> implements IAbiInfo {
    id?:number
    hash:string
    type:string
    fullName:string
    updatedAt?:Date
    static register(seq) {
        AbiInfo.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey:true, autoIncrement: true},
            hash: {type: DataTypes.STRING(66), allowNull: false, defaultValue: ''},
            type: {type: DataTypes.STRING(16), allowNull: false, defaultValue: ''},
            fullName: {type: DataTypes.STRING(1024), allowNull: false, defaultValue: ''},
            formatWithArg: {type: DataTypes.STRING(FormatWithArgMaxLength), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq, tableName: 'abi_stub', charset: 'ascii', collate: 'ascii_general_ci',
            indexes:[
                {name: 'idx_type_hash', unique:false, fields:[{name:'type'},{name:'hash'}]},
                {name: 'idx_type_name', unique:true, fields:[{name:'type'},{name:'fullName'}]},
            ]
        })
    }
}

export interface IContractABI {
    id?:number;
    contractId:number;
    abiId: number;
    updatedAt?:Date;
}
export class ContractABI extends Model<IContractABI> implements IContractABI {
    id?:number;
    contractId:number;
    abiId: number;
    updatedAt?:Date;
    static register(seq: Sequelize) {
        ContractABI.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey:true, autoIncrement: true},
            contractId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            abiId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq, tableName: 'contract_abi',
            indexes: [{
                name: 'idx_cid', fields:['contractId', 'abiId'], unique:true,
            }],
        })
    }
}
export let UPDATE_FIELDS_FOR_DUPLICATE_ABI: (keyof IAbiInfo)[] = ['updatedAt'];
export function setFieldsForUpdate(v: (keyof IAbiInfo)[]) {
    UPDATE_FIELDS_FOR_DUPLICATE_ABI = v;
}
// Refer:
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html
// https://docs.soliditylang.org/en/v0.5.3/abi-spec.html#events
export async function saveAbiInfo(abiObj:any, contractId?:number, dryRun = false) {
    const abi = (typeof abiObj === 'string') ? JSON.parse(abiObj) : abiObj;

    let iFace: Interface;
    try {
        iFace = new Interface(abi);
    } catch (e) {
        console.log(`failed to parse abi, contract id `, contractId, `abi`, abi, 'error is ', e);
        if (dryRun) {
            throw e;
        }
        return e.message?.includes('can not found matched coder');
    }

    const arr: IAbiInfo[] = [];
    const fragments = [...Object.values(iFace.fragments)];
    for (const fragment of fragments) {
        const type = fragment.type;
        if (type !== 'event' && type !== 'function') {
            continue;
        }

        const signature = fragment.format("sighash");
        const fullFormat = fragment.format("full");
        const hash = keccak256(Buffer.from(signature));

        if (signature.length > MaxFullName) {
            console.log(`skip entry exceeds max length , full name ${signature.length} > ${MaxFullName} \n`, signature);
            continue;
        }
        if (fullFormat.length > FormatWithArgMaxLength) {
            console.log(`skip entry exceeds max length , full format ${fullFormat.length} > ${FormatWithArgMaxLength} \n`, fullFormat);
            continue;
        }

        arr.push({
            type,
            fullName: signature,
            hash: type === 'function' ? hash.substring(0, 10) : hash,
            formatWithArg: fullFormat
        });
    }

    if (dryRun) {
        console.log(`abi beans are:`, arr);
        return true;
    }

    return AbiInfo.bulkCreate(arr, {
        updateOnDuplicate: UPDATE_FIELDS_FOR_DUPLICATE_ABI,
    }).then(arr=>{
        console.log(`saved abi info: ${arr.length}`);
        if (contractId) {
            return saveContractAbiRef(arr, contractId);
        }
    }).then(()=>{
        return true;
    }).catch(err=>{
        safeAddErrorLog('DB',`bulk-create-abi-info`, err);
        console.log(`bulk create abi info fail:`, err)
        return false;
    })
}
export async function saveContractAbiRef(arr: AbiInfo[], contractId: number) {
    return Promise.all(arr.map(async info => {
        const res = await AbiInfo.findOne({
            where: {type: info.type, fullName: info.fullName}
        });
        if (res) {
            return ContractABI.upsert({
                contractId, abiId: res.id,
            });
        } else {
            console.log(`DB: abi not found for `, info);
        }
    }))
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
        if (type !== 'event' && type !== 'function' && type !== 'error') {
            continue;
        }

        const signature = fragment.format("sighash");
        const fullFormat = fragment.format("full");
        const hash = keccak256(Buffer.from(signature));
        const fullFormatHash = keccak256(Buffer.from(fullFormat));

        if (signature.length > MaxFullName) {
            console.log(`Abi signature ${signature.length} exceeds max length ${MaxFullName}\n`, signature);
            continue;
        }
        if (fullFormat.length > FormatWithArgMaxLength) {
            console.log(`Abi fullFormat ${fullFormat.length} exceeds max length ${FormatWithArgMaxLength}\n`, fullFormat);
            continue;
        }

        list.push({
            type,
            fullFormatHash,
            fullFormat,
            hash: (type === 'function' || type === 'error') ? hash.substring(0, 10) : hash,
            signature,
        });
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
        console.log("Failed to save abi info", err);
    }
}

export async function saveContractAbiSigs(list: AbiSignature[], contractId: number) {
    const one = await ContractAbiSignature.findOne({where: {contractId}});
    if (one) {
        return;
    }

    const sigs = await Promise.all(list.map(item => AbiSignature
        .findOne({where: {type: item.type, fullFormatHash: item.fullFormatHash}})
        .then(item => ({contractId, abiId: item.id}))
    ));

    return ContractAbiSignature.bulkCreate(sigs);
}

export function parseAbiStr(str: string) {
        const jsonArr = JSON.parse(str);
        const iFace = new Interface(jsonArr);
        return iFace.format();
}

export async function saveAbiAnnounce(str: string, epoch:number) {
    let segments: string | Array<string>;
    try {
        segments = parseAbiStr(str);
    } catch (e) {
        console.log(`failed to parse abi at epoch ${epoch} for ${str}`, e);
        throw e;
    }
    return saveAbiInfo(segments);
}
