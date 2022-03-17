import {Model,Sequelize,DataTypes} from "sequelize";

export interface IContractVerify{
    id?:number
    base32:string
    // hex40id:number
    name:string
    compiler?:string
    version?:string
    creationData?:string
    constructorArgs?:string
    sourceCode?:string
    abi?:string
    creationDataHash?:string
    bytecodeHash?:string
    optimizeFlag?:boolean
    optimizeRuns?: number
    license?:string
    verifyResult?:boolean
    similarity?:number
    proxy?:boolean
    implementation?:string
    proxyPattern?:string
}

export class ContractVerify extends Model<IContractVerify> implements IContractVerify{
    id?:number
    base32:string
    // hex40id:number
    name:string
    compiler?:string
    version?:string
    creationData?:string
    constructorArgs?:string
    sourceCode?:string
    abi?:string
    creationDataHash?:string
    bytecodeHash?:string
    optimizeFlag?:boolean
    optimizeRuns?: number
    license?:string
    verifyResult?:boolean
    similarity?:number
    proxy?:boolean
    implementation?:string
    proxyPattern?:string

    static register(seq:Sequelize) {
        ContractVerify.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            base32: {type: DataTypes.CHAR(64), allowNull: false},
            // hex40id: {type: DataTypes.BIGINT, allowNull: false},

            name: {type: DataTypes.CHAR(255), allowNull: false},
            compiler: {type: DataTypes.CHAR(255), allowNull: true},
            version: {type: DataTypes.CHAR(255), allowNull: true},
            creationData: {type: DataTypes.TEXT, allowNull: true, },
            constructorArgs: {type: DataTypes.TEXT, allowNull: true, },
            sourceCode: {type: DataTypes.TEXT({length: 'long'}), allowNull: true, },
            abi: {type: DataTypes.TEXT, allowNull: true, },
            creationDataHash: {type: DataTypes.CHAR(64), allowNull: true, },
            bytecodeHash: {type: DataTypes.CHAR(64), allowNull: true, },
            optimizeFlag: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            optimizeRuns: {type: DataTypes.INTEGER, allowNull: true, },
            license: {type: DataTypes.CHAR(255), allowNull: true},

            verifyResult: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            similarity: {type: DataTypes.DECIMAL(10, 9), allowNull: true, },

            proxy: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            implementation: {type: DataTypes.CHAR(64), allowNull: true},
            proxyPattern: {type: DataTypes.CHAR(64), allowNull: true},
        },{
            tableName: 'contract_verify',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(contract: ContractVerify, dbTx = undefined): Promise<IContractVerify> {
        return await ContractVerify.create({
            base32:contract.base32,
            // hex40id:contract.hex40id,

            name:contract.name,
            compiler:contract.compiler,
            version:contract.version,
            creationData: contract.creationData,
            constructorArgs: contract.constructorArgs,
            sourceCode:contract.sourceCode,
            abi:contract.abi,
            creationDataHash:contract.creationDataHash,
            bytecodeHash:contract.bytecodeHash,
            optimizeFlag:contract.optimizeFlag,
            optimizeRuns: contract.optimizeRuns,
            license:contract.license,

            verifyResult:contract.verifyResult,
            similarity:contract.similarity,

            proxy:contract.proxy,
            implementation:contract.implementation,
            proxyPattern:contract.proxyPattern,
        }, {
            transaction: dbTx
        })
    }
}
