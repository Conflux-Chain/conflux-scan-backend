import {Model,Sequelize,DataTypes} from "sequelize";

export interface IToken{
    id?:number
    symbol:string
    name?:string
    holder:number
    base32:string
    hex40id:number
    type?:string
    icon?:string
    transfer?:number
    decimals?:number
    granularity?:number
    totalSupply?:number
    price?:number
    totalPrice?:number
    quoteUrl?:string
    marketCapId?:number
    moonDexSymbol?:string
    binanceSymbol?:string
    priceCNY?:number
    priceUSD?:number
    priceGBP?:number
    priceKRW?:number
    priceRUB?:number
    priceEUR?:number
    totalPriceCNY?:number
    totalPriceUSD?:number
    totalPriceGBP?:number
    totalPriceKRW?:number
    totalPriceRUB?:number
    totalPriceEUR?:number
}

export const TOKEN_ERC_1155 = 'erc1155'
export class Token extends Model<IToken> implements IToken{
    id?:number
    name?:string
    symbol:string
    holder:number
    base32:string
    hex40id:number
    type?:string
    icon?:string
    transfer?:number
    decimals?:number
    granularity?:number
    totalSupply?:number
    price?:number
    totalPrice?:number
    quoteUrl?:string
    marketCapId?:number
    moonDexSymbol?:string
    binanceSymbol?:string
    priceCNY?:number
    priceUSD?:number
    priceGBP?:number
    priceKRW?:number
    priceRUB?:number
    priceEUR?:number
    totalPriceCNY?:number
    totalPriceUSD?:number
    totalPriceGBP?:number
    totalPriceKRW?:number
    totalPriceRUB?:number
    totalPriceEUR?:number

    static register(seq:Sequelize) {
        Token.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            symbol: {type: DataTypes.CHAR(64), allowNull: false, },
            name: {type: DataTypes.CHAR(64), allowNull: false, defaultValue: ''},
            holder: {type: DataTypes.BIGINT, allowNull: false, },
            base32: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            hex40id: {type: DataTypes.BIGINT, allowNull: false, },
            type: {type: DataTypes.CHAR(16), allowNull: false, defaultValue: ''},
            icon: {type: DataTypes.BLOB('medium'), allowNull: true, },
            transfer: {type: DataTypes.BIGINT, allowNull: true, },
            decimals: {type: DataTypes.BIGINT, allowNull: true, },
            granularity: {type: DataTypes.BIGINT, allowNull: true, },
            totalSupply: {type: DataTypes.DECIMAL(36, 0), allowNull: true, },
            price: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPrice: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            quoteUrl: {type: DataTypes.CHAR(255), allowNull: true, },
            marketCapId: {type: DataTypes.INTEGER, allowNull: true, },
            moonDexSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            binanceSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            priceCNY: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            priceUSD: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            priceGBP: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            priceKRW: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            priceRUB: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            priceEUR: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPriceCNY:{type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPriceUSD:{type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPriceGBP:{type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPriceKRW:{type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPriceRUB:{type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPriceEUR:{type: DataTypes.DECIMAL(36, 18), allowNull: true, },
        },{
            tableName: 'token',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(token: Token, dbTx = undefined): Promise<IToken> {
        return await Token.create({
            name:token.name,
            symbol:token.symbol,
            holder:token.holder,
            base32:token.base32,
            hex40id:token.hex40id,
            type:token.type,
            icon:token.icon,
            transfer:token.transfer,
            decimals:token.decimals,
            granularity:token.granularity,
            totalSupply: token.totalSupply?Number(token.totalSupply):token.totalSupply,
            price:token.price,
            totalPrice:token.totalPrice,
            quoteUrl:token.quoteUrl,
            marketCapId:token.marketCapId,
            moonDexSymbol:token.moonDexSymbol,
            binanceSymbol:token.binanceSymbol,
            priceCNY:token.priceCNY,
            priceUSD:token.priceUSD,
            priceGBP:token.priceGBP,
            priceKRW:token.priceKRW,
            priceRUB:token.priceRUB,
            priceEUR:token.priceEUR,
            totalPriceCNY:token.totalPriceCNY,
            totalPriceUSD:token.totalPriceUSD,
            totalPriceGBP:token.totalPriceGBP,
            totalPriceKRW:token.totalPriceKRW,
            totalPriceRUB:token.totalPriceRUB,
            totalPriceEUR:token.totalPriceEUR,
        }, {
            transaction: dbTx
        })
    }
}
// erc 1155 token id
export interface INftId {
    id?:number,
    contractHexId:number,
    nftId: number
}
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
    transferAmount:number
    uniqueReceiver:number
    uniqueSender:number
}
// stat per token
export class DailyToken extends Model<IDailyToken> implements IDailyToken {
    id?:number
    hexId:number
    day:Date
    transferCount:number
    transferAmount:number
    uniqueReceiver:number
    uniqueSender:number
    static register(seq: Sequelize) {
        DailyToken.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            hexId: {type: DataTypes.BIGINT, allowNull: false, },
            day: {type: DataTypes.DATEONLY, allowNull: false, },
            transferCount: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            transferAmount: {type: DataTypes.STRING(78), allowNull: false, defaultValue: '0'},
            uniqueReceiver: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            uniqueSender: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
        },{
            tableName: T_DAILY_TOKEN,
            sequelize: seq,
            indexes:[{
                name: 'uk_hexId_day', fields:[{name:'hexId'},{name:'day'}], unique: true,
            }]
        })
    }
}