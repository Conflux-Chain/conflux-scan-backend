import {Model,Sequelize,DataTypes} from "sequelize";

export interface ITokenAutoDetect{
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
    holder?:number
    // price info
    price?:number
    totalPrice?:number
    quoteUrl?:string
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
    marketCapId?:number
    moonDexSymbol?:string
    moonSwapSymbol?:string
    binanceSymbol?:string
    // extra info
    icon?:string
    iconUrl?:string
    auditResult?:boolean
    fetchBalance?:boolean
}

export class TokenAutoDetect extends Model<ITokenAutoDetect> implements ITokenAutoDetect{
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
    holder?:number
    // price info
    price?:number
    totalPrice?:number
    quoteUrl?:string
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
    marketCapId?:number
    moonDexSymbol?:string
    moonSwapSymbol?:string
    binanceSymbol?:string
    // extra info
    icon?:string
    iconUrl?:string
    auditResult?:boolean
    fetchBalance?:boolean

    static register(seq:Sequelize) {
        TokenAutoDetect.init({
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
            transfer: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            holder: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            // price info
            price: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPrice: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            quoteUrl: {type: DataTypes.CHAR(255), allowNull: true, },
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
            marketCapId: {type: DataTypes.INTEGER, allowNull: true, },
            moonDexSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            moonSwapSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            binanceSymbol: {type: DataTypes.CHAR(20), allowNull: true, },
            // extra info
            icon: {type: DataTypes.BLOB('medium'), allowNull: true, },
            iconUrl: {type: DataTypes.STRING(128), allowNull: true, },
            auditResult: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            fetchBalance: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true},
        },{
            tableName: 'token_auto_detect',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(token: TokenAutoDetect, dbTx = undefined): Promise<TokenAutoDetect> {
        return await TokenAutoDetect.create({
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
            holder:token.holder,
            transfer:token.transfer,
            // price info
            price:token.price,
            totalPrice:token.totalPrice,
            quoteUrl:token.quoteUrl,
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
