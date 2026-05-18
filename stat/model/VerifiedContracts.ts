import {Model,Sequelize,DataTypes} from "sequelize";

export interface IVerifiedContracts{
    id?:number
    address:string
    addressId?: number
    name:string
    compiler?:string
    version?:string
    language?:string
    constructorArgs?:string
    codeFormat?:string
    sourceCode?:string
    abi?:string
    optimization?:string
    runs?: number
    license?:string
    libraries?: string
    evmVersion?: string
    similarMatchChainId?: number
    similarMatchAddress?: string
    matchId?: number
    verifiedAt?: Date
    deployer?: string
    epochNumber?: number
    txns?: number
    withNametag?: boolean
}

export class VerifiedContracts extends Model<IVerifiedContracts> implements IVerifiedContracts {
    id?: number
    address: string
    addressId?: number
    name: string
    compiler?: string
    version?: string
    language?:string
    constructorArgs?: string
    codeFormat?:string
    sourceCode?: string
    abi?: string
    optimization?: string
    runs?: number
    license?: string
    libraries?: string
    evmVersion?: string
    similarMatchChainId?: number
    similarMatchAddress?: string
    matchId?: number
    verifiedAt?: Date
    deployer?: string
    epochNumber?: number
    txns?: number
    withNametag?: boolean

    static register(seq: Sequelize) {
        VerifiedContracts.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            address: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            addressId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            name: {type: DataTypes.CHAR(255), allowNull: false},
            compiler: {type: DataTypes.CHAR(10), allowNull: false},
            version: {type: DataTypes.CHAR(255), allowNull: false},
            language: {type: DataTypes.CHAR(20), allowNull: false},
            constructorArgs: {type: DataTypes.TEXT},
            codeFormat: {type: DataTypes.CHAR(255), allowNull: false},
            sourceCode: {type: DataTypes.TEXT({length: 'long'}), allowNull: false,},
            abi: {type: DataTypes.TEXT, allowNull: false},
            optimization: {type: DataTypes.CHAR(20), allowNull: false, defaultValue: '0'},
            runs: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
            license: {type: DataTypes.CHAR(255)},
            libraries: {type: DataTypes.STRING(1024)},
            evmVersion: {type: DataTypes.CHAR(20)},
            similarMatchChainId: {type: DataTypes.INTEGER},
            similarMatchAddress: {type: DataTypes.CHAR(64)},
            matchId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            verifiedAt: {type: DataTypes.DATE, allowNull: false},
            deployer: {type: DataTypes.CHAR(64), allowNull: false},
            epochNumber: {type: DataTypes.BIGINT, allowNull: false},
            txns: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
            withNametag: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        }, {
            tableName: 'verified_contracts',
            sequelize: seq,
            timestamps: false,
        })
    }

    static async add(contract: VerifiedContracts, dbTx = undefined): Promise<IVerifiedContracts> {
        return await VerifiedContracts.create({
            address: contract.address,
            addressId: contract.addressId,
            name: contract.name,
            compiler: contract.compiler,
            version: contract.version,
            language: contract.language,
            constructorArgs: contract.constructorArgs,
            codeFormat: contract.codeFormat,
            sourceCode: contract.sourceCode,
            abi: contract.abi,
            optimization: contract.optimization,
            runs: contract.runs,
            license: contract.license,
            libraries: contract.libraries,
            evmVersion: contract.evmVersion,
            matchId: contract.matchId,
            verifiedAt: contract.verifiedAt,
            deployer: contract.deployer,
            epochNumber: contract.epochNumber,
            txns: contract.txns,
            withNametag: contract.withNametag,
        }, {
            transaction: dbTx
        })
    }
}
