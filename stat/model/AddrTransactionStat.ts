import {DataTypes, Model} from "sequelize";

export interface IAddrTransactionStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    sendCntr: bigint;
    recvCntr: bigint;
    minEpoch: number;
    maxEpoch: number;
}

export class AddrTransactionStat extends Model<IAddrTransactionStat> implements IAddrTransactionStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    sendCntr: bigint;
    recvCntr: bigint;
    minEpoch: number;
    maxEpoch: number;

    static register(sequelize) {
        AddrTransactionStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            bizId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},
            sendCntr: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            recvCntr: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'stat_addr_transaction',
            timestamps: true,
            indexes: [{
                name: "idx_bizId_statType_statTime",
                fields: ["bizId", "statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(addrTransactionStat: AddrTransactionStat, dbTx = undefined): Promise<AddrTransactionStat> {
        return await AddrTransactionStat.create({
            bizId: addrTransactionStat.bizId,
            statType: addrTransactionStat.statType,
            statTime: addrTransactionStat.statTime,
            sendCntr: addrTransactionStat.sendCntr,
            recvCntr: addrTransactionStat.recvCntr,
            minEpoch: addrTransactionStat.minEpoch,
            maxEpoch: addrTransactionStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}