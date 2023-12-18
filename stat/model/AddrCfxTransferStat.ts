import {DataTypes, Model} from "sequelize";

export interface IAddrCfxTransferStat {
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    sendCntr: bigint;
    recvCntr: bigint;
    sendValue: bigint;
    recvValue: bigint;
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
    sendValue: bigint;
    recvValue: bigint;
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
            sendValue: {type: DataTypes.DECIMAL(60, 0), allowNull: false, defaultValue: 0},
            recvValue: {type: DataTypes.DECIMAL(60, 0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        }, {
            sequelize: sequelize,
            tableName: 'stat_addr_cfx_transfer',
            timestamps: true,
            indexes: [{
                name: "idx_statType_bizId_statTime",
                fields: ["statType", "bizId", "statTime"],
                unique: true
            }, {
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
            }, {
                name: "idx_statType_bizId_minEpoch_maxEpoch",
                fields: ["statType", "bizId", "minEpoch", "maxEpoch"],
            }, {
                name: "idx_statType_minEpoch_maxEpoch",
                fields: ["statType", "minEpoch", "maxEpoch"],
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
            sendValue: addrCfxTransferStat.sendValue,
            recvValue: addrCfxTransferStat.recvValue,
            minEpoch: addrCfxTransferStat.minEpoch,
            maxEpoch: addrCfxTransferStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}