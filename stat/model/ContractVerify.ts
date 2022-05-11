import {Model,Sequelize,DataTypes} from "sequelize";

export interface IContractVerify{
    id?:number
    base32:string
    // hex40id:number
    name:string
    compiler?:string
    version?:string
    constructorArgs?:string
    sourceCode?:string
    abi?:string
    optimizeFlag?:boolean
    optimizeRuns?: number
    license?:string
    verifyResult?:boolean
    matchCode?:number
    matchDesc?:string
    proxy?:boolean
    implementation?:string
    proxyPattern?:string
    codeHash?:string
    similarMatch?:string
    guid?:string
    taskStatus?: number // 20(submitted), 21(processing), 22(done)
    warnings?:string
    errors?:string
}

export class ContractVerify extends Model<IContractVerify> implements IContractVerify {
    id?: number
    base32: string
    // hex40id:number
    name: string
    compiler?: string
    version?: string
    constructorArgs?: string
    sourceCode?: string
    abi?: string
    optimizeFlag?: boolean
    optimizeRuns?: number
    license?: string
    verifyResult?: boolean
    matchCode?: number
    matchDesc?: string
    proxy?: boolean
    implementation?: string
    proxyPattern?: string
    codeHash?: string
    similarMatch?: string
    guid?: string
    taskStatus?: number
    warnings?: string
    errors?: string

    static register(seq: Sequelize) {
        ContractVerify.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            base32: {type: DataTypes.CHAR(64), allowNull: false},
            // hex40id: {type: DataTypes.BIGINT, allowNull: false},

            name: {type: DataTypes.CHAR(255), allowNull: false},
            compiler: {type: DataTypes.CHAR(255), allowNull: true},
            version: {type: DataTypes.CHAR(255), allowNull: true},
            constructorArgs: {type: DataTypes.TEXT, allowNull: true,},
            sourceCode: {type: DataTypes.TEXT({length: 'long'}), allowNull: true,},
            abi: {type: DataTypes.TEXT, allowNull: true,},
            optimizeFlag: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            optimizeRuns: {type: DataTypes.INTEGER, allowNull: true,},
            license: {type: DataTypes.CHAR(255), allowNull: true},
            verifyResult: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            matchCode: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
            matchDesc: {type: DataTypes.CHAR(20), allowNull: true},

            proxy: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            implementation: {type: DataTypes.CHAR(64), allowNull: true},
            proxyPattern: {type: DataTypes.CHAR(64), allowNull: true},
            codeHash: {type: DataTypes.CHAR(64), allowNull: true,},
            similarMatch: {type: DataTypes.CHAR(64), allowNull: true},
            guid: {type: DataTypes.CHAR(50), allowNull: true},
            taskStatus: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 21},
            warnings: {type: DataTypes.TEXT, allowNull: true,},
            errors: {type: DataTypes.TEXT, allowNull: true,},
        }, {
            tableName: 'contract_verify',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(contract: ContractVerify, dbTx = undefined): Promise<IContractVerify> {
        return await ContractVerify.create({
            base32: contract.base32,
            // hex40id:contract.hex40id,

            name: contract.name,
            compiler: contract.compiler,
            version: contract.version,
            constructorArgs: contract.constructorArgs,
            sourceCode: contract.sourceCode,
            abi: contract.abi,
            optimizeFlag: contract.optimizeFlag,
            optimizeRuns: contract.optimizeRuns,
            license: contract.license,
            verifyResult: contract.verifyResult,
            matchCode: contract.matchCode,
            matchDesc: contract.matchDesc,

            proxy: contract.proxy,
            implementation: contract.implementation,
            proxyPattern: contract.proxyPattern,
            codeHash: contract.codeHash,
            similarMatch: contract.similarMatch,
            guid: contract.guid,
            taskStatus: contract.taskStatus,
            warnings: contract.warnings,
            errors: contract.errors,
        }, {
            transaction: dbTx
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
