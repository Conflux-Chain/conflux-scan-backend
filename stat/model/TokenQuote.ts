import {Model,Sequelize,DataTypes} from "sequelize";

export interface ITokenQuote{
    id?:number
    address:string
    name?:string
    symbol:string
    convertSymbol:string
    price?:number
}

export class TokenQuote extends Model<ITokenQuote> implements ITokenQuote{
    id?:number
    address:string
    name?:string
    symbol:string
    convertSymbol:string
    price?:number

    static register(seq:Sequelize) {
        TokenQuote.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            address: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            name: {type: DataTypes.CHAR(64), allowNull: false, defaultValue: ''},
            symbol: {type: DataTypes.CHAR(64), allowNull: false, },
            convertSymbol: {type: DataTypes.CHAR(10), allowNull: false, },
            price: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
        },{
            tableName: 'token_quote',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(tokenQuote: TokenQuote, dbTx = undefined): Promise<ITokenQuote> {
        return await TokenQuote.create({
            address:tokenQuote.address,
            name:tokenQuote.name,
            symbol:tokenQuote.symbol,
            convertSymbol:tokenQuote.convertSymbol,
            price:tokenQuote.price,
        }, {
            transaction: dbTx
        })
    }
}
