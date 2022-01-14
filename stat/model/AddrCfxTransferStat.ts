import {DataTypes, Model} from "sequelize";

export interface IAddrCfxTransferStat {
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    sendCntr: bigint;
    recvCntr: bigint;
    minEpoch: number;
    maxEpoch: number;
}

export class AddrCfxTransferStat extends Model<IAddrCfxTransferStat> implements IAddrCfxTransferStat {
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    sendCntr: bigint;
    recvCntr: bigint;
    minEpoch: number;
    maxEpoch: number;

    static register(sequelize) {
        AddrCfxTransferStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            bizId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},
            sendCntr: {type: DataTypes.DECIMAL(60, 0), allowNull: false, defaultValue: 0},
            recvCntr: {type: DataTypes.DECIMAL(60, 0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        }, {
            sequelize: sequelize,
            tableName: 'stat_addr_cfx_transfer',
            timestamps: true,
            indexes: [{
                name: "idx_bizId_statType_statTime",
                fields: ["bizId", "statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(addrCfxTransferStat: AddrCfxTransferStat, dbTx = undefined): Promise<AddrCfxTransferStat> {
        return await AddrCfxTransferStat.create({
            bizId: addrCfxTransferStat.bizId,
            statType: addrCfxTransferStat.statType,
            statTime: addrCfxTransferStat.statTime,
            sendCntr: addrCfxTransferStat.sendCntr,
            recvCntr: addrCfxTransferStat.recvCntr,
            minEpoch: addrCfxTransferStat.minEpoch,
            maxEpoch: addrCfxTransferStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}