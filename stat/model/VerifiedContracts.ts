import {Model,Sequelize,DataTypes} from "sequelize";

export interface IVerifiedContracts{
    id?:number
    address:string
    name:string
    language?:string
    version?:string
    constructorArgs?:string
    sourceCode?:string
    abi?:string
    optimization?:string
    runs?: number
    license?:string
    libraries?: string
    evmVersion?: string
    similarMatchChainId?: number
    similarMatchAddress?: string
}

export class VerifiedContracts extends Model<IVerifiedContracts> implements IVerifiedContracts {
    id?: number
    address: string
    name: string
    language?: string
    version?: string
    constructorArgs?: string
    sourceCode?: string
    abi?: string
    optimization?: string
    runs?: number
    license?: string
    libraries?: string
    evmVersion?: string
    similarMatchChainId?: number
    similarMatchAddress?: string

    static register(seq: Sequelize) {
        VerifiedContracts.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            address: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            name: {type: DataTypes.CHAR(255), allowNull: false},
            language: {type: DataTypes.CHAR(255), allowNull: false},
            version: {type: DataTypes.CHAR(255), allowNull: false},
            constructorArgs: {type: DataTypes.TEXT},
            sourceCode: {type: DataTypes.TEXT({length: 'long'}), allowNull: false,},
            abi: {type: DataTypes.TEXT, allowNull: false},
            optimization: {type: DataTypes.CHAR(20), allowNull: false, defaultValue: '0'},
            runs: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
            license: {type: DataTypes.CHAR(255)},
            libraries: {type: DataTypes.STRING(1024)},
            evmVersion: {type: DataTypes.CHAR(20)},
            similarMatchChainId: {type: DataTypes.INTEGER},
            similarMatchAddress: {type: DataTypes.CHAR(64)},
        }, {
            tableName: 'verified_contracts',
            sequelize: seq,
            timestamps: false,
        })
    }

    static async add(contract: VerifiedContracts, dbTx = undefined): Promise<IVerifiedContracts> {
        return await VerifiedContracts.create({
            address: contract.address,
            name: contract.name,
            language: contract.language,
            version: contract.version,
            constructorArgs: contract.constructorArgs,
            sourceCode: contract.sourceCode,
            abi: contract.abi,
            optimization: contract.optimization,
            runs: contract.runs,
            license: contract.license,
            libraries: contract.libraries,
            evmVersion: contract.evmVersion,
        }, {
            transaction: dbTx
        })
    }
}
