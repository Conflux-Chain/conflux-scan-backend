import {DataTypes, Model, QueryTypes, Sequelize, UniqueConstraintError} from "sequelize";
import {CENSOR_STATUS} from "../service/censor/CensorService";

export interface IContract{
    id?:number
    epoch: number
    base32:string
    hex40id:number
    name?:string
    website?:string
    abi?:string
    sourceCode?:string
    icon?:string
    destroyed?:boolean
    censorStatus?: number
    nameSymbolFailed?: boolean;
    createdAt?: Date
}

export class Contract extends Model<IContract> implements IContract{
    id?:number
    epoch: number
    base32:string
    hex40id:number
    name?:string
    website?:string
    abi?:string
    sourceCode?:string
    icon?:string
    destroyed?:boolean
    censorStatus?: number
    nameSymbolFailed?: boolean;
    createdAt?: Date

    static register(seq:Sequelize) {
        Contract.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            epoch: {type: DataTypes.BIGINT, allowNull: true},
            base32: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            hex40id: {type: DataTypes.BIGINT, allowNull: false, unique: true},
            name: {type: DataTypes.CHAR(255), allowNull: true},
            website: {type: DataTypes.CHAR(255), allowNull: true},
            abi: {type: DataTypes.TEXT, allowNull: true, },
            sourceCode: {type: DataTypes.TEXT({length:'long'}), allowNull: true, },
            icon: {type: DataTypes.BLOB('medium'), allowNull: true, },
            destroyed: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            nameSymbolFailed: {type: DataTypes.BOOLEAN, allowNull: true, defaultValue: null},
            censorStatus: {type: DataTypes.INTEGER, allowNull: false, defaultValue: CENSOR_STATUS.TO_CENSOR},
        },{
            tableName: 'contract',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(contract: Contract, dbTx = undefined): Promise<IContract> {
        return await Contract.create(contract, {
            transaction: dbTx
        }).catch(err=>{
            if (err instanceof UniqueConstraintError) {
                // contract which created by transaction directly, will be saved when sync tx.
                return contract
            }
            throw err;
        })
    }
}

export interface IProxyVerify{
    id?:number
    base32:string
    expectedImpl?: string
    guid?:string
}

export class ProxyVerify extends Model<IProxyVerify> implements IProxyVerify{
    id?:number
    base32:string
    expectedImpl?: string
    guid?:string

    static register(seq:Sequelize) {
        ProxyVerify.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            base32: {type: DataTypes.CHAR(64), allowNull: false},
            guid: {type: DataTypes.CHAR(50), allowNull: true},
            expectedImpl: {type: DataTypes.CHAR(64), allowNull: true},
        },{
            tableName: 'proxy_verify',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(proxy: ProxyVerify, dbTx = undefined): Promise<IProxyVerify> {
        return await ProxyVerify.create({
            base32:proxy.base32,
            expectedImpl: proxy.expectedImpl,
            guid:proxy.guid,
        }, {
            transaction: dbTx
        })
    }
}
