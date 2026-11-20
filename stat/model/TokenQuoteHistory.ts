import {DataTypes, Model, Sequelize} from 'sequelize';

interface ITokenQuoteHistory {
    id?: number
    tokenId: number
    source: string
    convertSymbol: string
    price: number | string
    priceUpdatedAt: Date
}

// DEX quotes are sampled here because token_quote holds only the latest quote per source.
export class TokenQuoteHistory extends Model<ITokenQuoteHistory> implements ITokenQuoteHistory {
    id?: number
    tokenId: number
    source: string
    convertSymbol: string
    price: number | string
    priceUpdatedAt: Date

    static register(seq: Sequelize) {
        TokenQuoteHistory.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            tokenId: {type: DataTypes.BIGINT, allowNull: false},
            source: {type: DataTypes.STRING(32), allowNull: false},
            convertSymbol: {type: DataTypes.CHAR(10), allowNull: false},
            price: {type: DataTypes.DECIMAL(36, 18), allowNull: false},
            priceUpdatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            tableName: 'token_quote_history',
            sequelize: seq,
            timestamps: false,
            indexes: [
                {name: 'idx_token_quote_history_lookup', fields: ['tokenId', 'source', 'convertSymbol', 'priceUpdatedAt']},
                {name: 'idx_token_quote_history_cleanup', fields: ['priceUpdatedAt']},
            ],
        });
    }
}
