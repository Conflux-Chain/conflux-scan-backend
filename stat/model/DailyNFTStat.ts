import {DataTypes, Model} from "sequelize";

export interface IDailyNFTStat{
    id?: number,
    statTime: Date,
    statType: string,

    nftAsset: bigint,
    nftContract: bigint,
    nftTransfer: bigint,

    nftAssetTotal: bigint,
    nftContractTotal: bigint,
    nftTransferTotal: bigint,
}

export class DailyNFTStat extends Model<IDailyNFTStat> implements IDailyNFTStat{
    id?: number;
    statTime: Date;
    statType: string;

    nftAsset: bigint;
    nftContract: bigint;
    nftTransfer: bigint;

    nftAssetTotal: bigint;
    nftContractTotal: bigint;
    nftTransferTotal: bigint;

    static register(sequelize) {
        DailyNFTStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statTime: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},

            nftAsset: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            nftContract: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            nftTransfer: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},

            nftAssetTotal: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            nftContractTotal: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
            nftTransferTotal: {type: DataTypes.DECIMAL(20,0), allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'daily_nft_stat',
            timestamps: true,
            indexes: [{
                name: "idx_statTime_statType",
                fields: ["statTime", "statType"],
                unique: true,
            }]
        })
    }

    static async add(nftStat: DailyNFTStat, dbTx = undefined): Promise<IDailyNFTStat> {
        return await DailyNFTStat.create({
            statTime: nftStat.statTime,
            statType: nftStat.statType,

            nftAsset: nftStat.nftAsset,
            nftContract: nftStat.nftContract,
            nftTransfer: nftStat.nftTransfer,

            nftAssetTotal: nftStat.nftAssetTotal,
            nftContractTotal: nftStat.nftContractTotal,
            nftTransferTotal: nftStat.nftTransferTotal,
        }, {
            transaction: dbTx
        })
    }
}