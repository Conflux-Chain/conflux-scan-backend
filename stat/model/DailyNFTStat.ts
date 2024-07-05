import {DataTypes, Model} from "sequelize";

export interface IDailyNFTHolder{
    id?: number,
    statTime: Date,
    statType: string,
    holderCount721: number
    holderCount1155: number
    holderCount: number
}

export class DailyNFTHolder extends Model<IDailyNFTHolder> implements IDailyNFTHolder{
    id?: number;
    statTime: Date;
    statType: string;
    holderCount721: number;
    holderCount1155: number;
    holderCount: number;
    static register(sequelize) {
        DailyNFTHolder.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            statTime: {type: DataTypes.DATE, allowNull: false},
            statType: {type: DataTypes.CHAR(3), allowNull: false, defaultValue: '1d'},
            holderCount721: {type: DataTypes.BIGINT, allowNull: false},
            holderCount1155: {type: DataTypes.BIGINT, allowNull: false},
            holderCount: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: sequelize,
            tableName: 'daily_nft_holder',
            timestamps: true,
            indexes: [{
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(dailyNFTHolder: DailyNFTHolder, dbTx = undefined): Promise<DailyNFTHolder> {
        return await DailyNFTHolder.create({
            statTime: dailyNFTHolder.statTime,
            statType: dailyNFTHolder.statType,
            holderCount721: dailyNFTHolder.holderCount721,
            holderCount1155: dailyNFTHolder.holderCount1155,
            holderCount: dailyNFTHolder.holderCount,
        }, {
            transaction: dbTx
        })
    }
}

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
                name: "idx_statType_statTime",
                fields: ["statType", "statTime"],
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