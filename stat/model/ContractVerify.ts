import {Model,Sequelize,DataTypes} from "sequelize";

export interface IContractVerify{
    id?:number
    base32:string
    hex40id:number
    name:string
    compiler?:string
    version?:string
    sourceCode?:string
    abi?:string
    optimizeFlag?:boolean
    optimizeRuns?: number
    license?:string
    verifyResult?:boolean
    similarity?:number
}

export class ContractVerify extends Model<IContractVerify> implements IContractVerify{
    id?:number
    base32:string
    hex40id:number
    name:string
    compiler?:string
    version?:string
    sourceCode?:string
    abi?:string
    optimizeFlag?:boolean
    optimizeRuns?: number
    license?:string
    verifyResult?:boolean
    similarity?:number

    static register(seq:Sequelize) {
        ContractVerify.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            base32: {type: DataTypes.CHAR(64), allowNull: false},
            hex40id: {type: DataTypes.BIGINT, allowNull: false},

            name: {type: DataTypes.CHAR(255), allowNull: false},
            compiler: {type: DataTypes.CHAR(255), allowNull: true},
            version: {type: DataTypes.CHAR(255), allowNull: true},
            sourceCode: {type: DataTypes.TEXT, allowNull: true, },
            abi: {type: DataTypes.TEXT, allowNull: true, },
            optimizeFlag: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            optimizeRuns: {type: DataTypes.INTEGER, allowNull: true, },
            license: {type: DataTypes.CHAR(255), allowNull: true},

            verifyResult: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            similarity: {type: DataTypes.DECIMAL(10, 9), allowNull: true, },
        },{
            tableName: 'contract_verify',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(contract: ContractVerify, dbTx = undefined): Promise<IContractVerify> {
        return await ContractVerify.create({
            base32:contract.base32,
            hex40id:contract.hex40id,

            name:contract.name,
            compiler:contract.compiler,
            version:contract.version,
            sourceCode:contract.sourceCode,
            abi:contract.abi,
            optimizeFlag:contract.optimizeFlag,
            optimizeRuns: contract.optimizeRuns,
            license:contract.license,

            verifyResult:contract.verifyResult,
            similarity:contract.similarity,
        }, {
            transaction: dbTx
        })
    }
}
