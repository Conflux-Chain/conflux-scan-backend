import {Model, Sequelize, DataTypes} from "sequelize";

export interface ITokenQuoteTrack {
    id?: number
    address: string
    name: string
    symbol: string
    convertSymbol: string
    price: number
}

export class TokenQuoteTrack extends Model<ITokenQuoteTrack> implements ITokenQuoteTrack {
    id?: number
    address: string
    name: string
    symbol: string
    convertSymbol: string
    price: number

    static register(seq: Sequelize) {
        TokenQuoteTrack.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            address: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            name: {type: DataTypes.CHAR(64), allowNull: false},
            symbol: {type: DataTypes.CHAR(64), allowNull: false},
            convertSymbol: {type: DataTypes.CHAR(10), allowNull: false},
            price: {type: DataTypes.DECIMAL(36, 18)},
        }, {
            tableName: 'token_quote',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(tokenQuote: TokenQuoteTrack, dbTx = undefined): Promise<ITokenQuoteTrack> {
        return await TokenQuoteTrack.create({
            address: tokenQuote.address,
            name: tokenQuote.name,
            symbol: tokenQuote.symbol,
            convertSymbol: tokenQuote.convertSymbol,
            price: tokenQuote.price,
        }, {
            transaction: dbTx
        })
    }
}
