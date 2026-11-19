import {Model, Sequelize, DataTypes} from "sequelize";

export interface ITokenQuoteTrack {
    id?: number
    tokenId: number
    source: string
    convertSymbol: string
    price: number
    priceChange24h?: number | null
    priceUpdatedAt: Date
}

export class TokenQuoteTrack extends Model<ITokenQuoteTrack> implements ITokenQuoteTrack {
    id?: number
    tokenId: number
    source: string
    convertSymbol: string
    price: number
    priceChange24h?: number | null
    priceUpdatedAt: Date

    static register(seq: Sequelize) {
        TokenQuoteTrack.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            tokenId: {type: DataTypes.BIGINT, allowNull: false},
            source: {type: DataTypes.STRING(32), allowNull: false},
            convertSymbol: {type: DataTypes.CHAR(10), allowNull: false},
            price: {type: DataTypes.DECIMAL(36, 18)},
            priceChange24h: {type: DataTypes.DOUBLE, allowNull: true},
            priceUpdatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            tableName: 'token_quote',
            sequelize: seq,
            timestamps: true,
            indexes: [
                {name: 'uk_token_quote_track_token_source_convert', fields: ['tokenId', 'source', 'convertSymbol'], unique: true},
                {name: 'idx_token_quote_track_updated', fields: ['tokenId', 'priceUpdatedAt']},
            ],
        })
    }

    static async add(tokenQuote: TokenQuoteTrack, dbTx = undefined): Promise<ITokenQuoteTrack> {
        return await TokenQuoteTrack.create({
            tokenId: tokenQuote.tokenId,
            source: tokenQuote.source,
            convertSymbol: tokenQuote.convertSymbol,
            price: tokenQuote.price,
            priceChange24h: tokenQuote.priceChange24h ?? null,
            priceUpdatedAt: tokenQuote.priceUpdatedAt,
        }, {
            transaction: dbTx
        })
    }
}
