import {DataTypes, Model} from "sequelize";

export interface ITokenTransferStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    transferCntr: bigint;
    minEpoch: number;
    maxEpoch: number;
}

export class TokenTransferStat extends Model<ITokenTransferStat> implements ITokenTransferStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    transferCntr: bigint;
    minEpoch: number;
    maxEpoch: number;

    static register(sequelize) {
        TokenTransferStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            bizId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},
            transferCntr: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'stat_token_transfer',
            timestamps: true,
            indexes: [{
                name: "idx_bizId_statType_statTime",
                fields: ["bizId", "statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(tokenTransferStat: TokenTransferStat, dbTx = undefined): Promise<TokenTransferStat> {
        return await TokenTransferStat.create({
            bizId: tokenTransferStat.bizId,
            statType: tokenTransferStat.statType,
            statTime: tokenTransferStat.statTime,
            transferCntr: tokenTransferStat.transferCntr,
            minEpoch: tokenTransferStat.minEpoch,
            maxEpoch: tokenTransferStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}