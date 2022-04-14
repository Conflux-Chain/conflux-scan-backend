import {Model,Sequelize,DataTypes} from "sequelize";
import {addTokenCache} from "../service/tool/TokenTool";

export interface IToken{
    id?:number
    // basic info
    hex40id:number
    base32:string
    name?:string
    symbol?:string
    decimals?:number
    granularity?:number
    totalSupply?:number
    // advance info
    type?:string
    transfer?:number
    transferLatest?:number
    holder?:number
    // price info
    price?:number
    totalPrice?:number
    quoteUrl?:string
    marketCapId?:number
    moonDexSymbol?:string
    moonSwapSymbol?:string
    binanceSymbol?:string
    // security info
    securityCredits?:number
    auditResult?:boolean
    destroyed?:boolean
    // extra info
    icon?:string
    iconUrl?:string
    website?:string
    portalSupport?:boolean
    fetchBalance?:boolean
    updatedAt?:Date
}

export const TOKEN_ERC_1155 = 'erc1155'
export class Token extends Model<IToken> implements IToken{
    id?:number
    // basic info
    hex40id:number
    base32:string
    name?:string
    symbol:string
    decimals?:number
    granularity?:number
    totalSupply?:number
    // advance info
    type?:string
    transfer?:number
    transferLatest?:number
    holder:number
    // price info
    price?:number
    totalPrice?:number
    quoteUrl?:string
    marketCapId?:number
    moonDexSymbol?:string
    moonSwapSymbol?:string
    binanceSymbol?:string
    // security info
    securityCredits?:number
    auditResult?:boolean
    destroyed?:boolean
    // extra info
    icon?:string
    iconUrl?:string
    website?:string
    portalSupport?:boolean
    fetchBalance?:boolean

    static register(seq:Sequelize) {
        Token.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            // basic info
            hex40id: {type: DataTypes.BIGINT, allowNull: false, },
            base32: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            name: {type: DataTypes.CHAR(64), allowNull: true},
            symbol: {type: DataTypes.CHAR(64), allowNull: true },
            decimals: {type: DataTypes.BIGINT, allowNull: true, },
            granularity: {type: DataTypes.BIGINT, allowNull: true, },
            totalSupply: {type: DataTypes.DECIMAL(36, 0), allowNull: true, },
            // advance info
            type: {type: DataTypes.CHAR(16), allowNull: false, defaultValue: ''},
            transfer: {type: DataTypes.BIGINT, allowNull: true, },
            transferLatest: {type: DataTypes.BIGINT, allowNull: true, },
            holder: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
            // price info
            price: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPrice: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            quoteUrl: {type: DataTypes.CHAR(255), allowNull: true, },
            marketCapId: {type: DataTypes.INTEGER, allowNull: true, },
            moonDexSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            moonSwapSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            binanceSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            // security info
            securityCredits: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
            auditResult: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            destroyed: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            // extra info
            icon: {type: DataTypes.BLOB('medium'), allowNull: true, },
            iconUrl: {type: DataTypes.STRING(128), allowNull: true, },
            website: {type: DataTypes.CHAR(255), allowNull: true},
            portalSupport: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            fetchBalance: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
        },{
            tableName: 'token',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(token: Token, dbTx = undefined): Promise<Token> {
        addTokenCache(token)
        return await Token.create({
            // basic info
            hex40id:token.hex40id,
            base32:token.base32,
            name:token.name,
            symbol:token.symbol,
            decimals:token.decimals,
            granularity:token.granularity,
            totalSupply: token.totalSupply?Number(token.totalSupply):token.totalSupply,
            // advance info
            type:token.type,
            transfer:token.transfer,
            transferLatest: token.transferLatest,
            holder:token.holder,
            // price info
            price:token.price,
            totalPrice:token.totalPrice,
            quoteUrl:token.quoteUrl,
            marketCapId:token.marketCapId,
            moonDexSymbol:token.moonDexSymbol,
            moonSwapSymbol:token.moonSwapSymbol,
            binanceSymbol:token.binanceSymbol,
            // extra info
            icon:token.icon,
        }, {
            transaction: dbTx
        })
    }
}
// alter table erc1155_data add column latestEpoch bigint unsigned not null default 0;
export interface IErc1155Data {
    id?:number; contractId:number; addressId:number; tokenId:string; amount: number;
    epoch: number;
    // a reference to check confirmation
    latestEpoch: bigint;
}
export class Erc1155Data extends Model<IErc1155Data> implements IErc1155Data {
    id?:number; contractId:number; addressId:number; tokenId:string; amount: number;
    epoch: number;  latestEpoch: bigint;
    static register(seq: Sequelize) {
        Erc1155Data.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            contractId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            addressId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            tokenId: {type: DataTypes.STRING(78), allowNull: false, },
            amount: {type: DataTypes.DECIMAL(65, 0), allowNull: false, },
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            latestEpoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
        }, {
            sequelize: seq, tableName: 'erc1155_data',
            indexes: [
                {name: 'uk_contract_addr_tid', fields:['contractId','addressId','tokenId'], unique: true},
            ]
        })
    }
}
//
export interface INftMint {
    id?:number
    epoch: number
    contractId: number
    blockIndex: number
    txIndex: number
    toId: number
    tokenId:string
    updatedAt:Date
}
export class NftMint extends Model<INftMint> implements INftMint {
    id?:number
    epoch: number
    contractId: number
    blockIndex: number
    txIndex: number
    toId: number
    tokenId:string
    updatedAt:Date
    static register(seq:Sequelize) {
        NftMint.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            contractId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            tokenId: {type: DataTypes.STRING(78), allowNull: false, },
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            toId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            updatedAt: {type: DataTypes.DATE, allowNull: false, },
        },{
            sequelize: seq,
            tableName: 'nft_mint_2',
            indexes: [
                {name: 'idx_ctct_tid', fields:['contractId','tokenId'], unique: true},
                {name: 'idx_ctct_update', fields:['contractId','updatedAt'], },
                {name: 'idx_ctct_toId_update', fields:['contractId','toId', 'updatedAt'], },
                {name: 'idx_toId_update', fields:['toId', 'updatedAt'], },
            ]
        })
    }
}

// erc 1155 token id
export interface INftId {
    id?:number,
    contractHexId:number,
    nftId: number
}

// Deprecated, nftId should be string as it's uint256.
export class NftId extends Model<INftId> implements INftId {
    id?:number
    contractHexId:number
    nftId: number
    static register(seq: Sequelize) {
        NftId.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            nftId: {type: DataTypes.BIGINT, allowNull: false, },
            contractHexId: {type: DataTypes.BIGINT, allowNull: false, },
        },{
            tableName: 'nft_id',
            sequelize: seq,
            indexes:[
                {name: 'idx_hex_id_token_id', unique:true, fields:[
                        {name: 'contractHexId'},
                        {name: 'nftId', order: "DESC"},
                    ]}
            ]
        })
    }
}
export const T_DAILY_TOKEN = 'daily_token'
export interface IDailyToken {
    id?:number
    hexId:number
    day:Date
    transferCount:number
    transferAmount:string
    uniqueReceiver:number
    uniqueSender:number
    holderCount:number
    participants:number
}
// stat per token
export class DailyToken extends Model<IDailyToken> implements IDailyToken {
    id?:number
    hexId:number
    day:Date
    transferCount:number
    transferAmount:string
    uniqueReceiver:number
    uniqueSender:number
    holderCount:number
    participants:number
    static register(seq: Sequelize) {
        DailyToken.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            hexId: {type: DataTypes.BIGINT, allowNull: false, },
            day: {type: DataTypes.DATEONLY, allowNull: false, },
            transferCount: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            transferAmount: {type: DataTypes.STRING(78), allowNull: false, defaultValue: '0'},
            uniqueReceiver: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            uniqueSender: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            holderCount: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            participants: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
        },{
            tableName: T_DAILY_TOKEN,
            sequelize: seq,
            indexes:[{
                name: 'uk_hexId_day', fields:[{name:'hexId'},{name:'day'}], unique: true,
            }]
        })
    }

    static async calcRecentIncrease(hexId: number) : Promise<[number, DailyToken, DailyToken]> {
        if (Date.now() < new Date('2022-03-11').getTime()) {
            // do not show it when fixing data.
            return [0, null, null]
        }
        const list = await DailyToken.findAll({
                where:{hexId: hexId},
                order:[['day','desc']], limit: 3}
            )
        if (list.length < 2) {
            return [0,list[0],null]
        }
        // two or three record, d1 is latest day and may be in progress.
        const [d1,d2,d3] = list
        // recent 1 >= recent 2
        if (d1.holderCount && d2.holderCount && d1.holderCount >= d2.holderCount) {
            return [(d1.holderCount - d2.holderCount) / d2.holderCount, d1, d2]
        }
        // recent 2 compare recent 3
        if (d3 && d2.holderCount && d3.holderCount) {
            return [(d2.holderCount - d3.holderCount) / d3.holderCount, d2, d3]
        }
        return [0, d1, d2]
    }
}
