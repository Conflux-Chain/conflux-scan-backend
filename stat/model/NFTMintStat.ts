import {DataTypes, Model} from "sequelize";

export interface IDailyNFTMintStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    nftAsset: bigint;
    minEpoch: number;
    maxEpoch: number;
}

export class NFTMintStat extends Model<IDailyNFTMintStat> implements IDailyNFTMintStat{
    id?: number;
    bizId: number;
    statType: string;
    statTime: Date;
    nftAsset: bigint;
    minEpoch: number;
    maxEpoch: number;

    static register(sequelize) {
        NFTMintStat.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            bizId: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            statType: {type: DataTypes.CHAR(2), allowNull: false, defaultValue: '1d'},
            statTime: {type: DataTypes.DATE, allowNull: false},
            nftAsset: {type: DataTypes.DECIMAL(60,0), allowNull: false, defaultValue: 0},
            minEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            maxEpoch: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
        },{
            sequelize: sequelize,
            tableName: 'stat_nft_mint',
            timestamps: true,
            indexes: [{
                name: "idx_bizId_statType_statTime",
                fields: ["bizId", "statType", "statTime"],
                unique: true,
            }]
        })
    }

    static async add(nftMintStat: NFTMintStat, dbTx = undefined): Promise<NFTMintStat> {
        return await NFTMintStat.create({
            bizId: nftMintStat.bizId,
            statType: nftMintStat.statType,
            statTime: nftMintStat.statTime,
            nftAsset: nftMintStat.nftAsset,
            minEpoch: nftMintStat.minEpoch,
            maxEpoch: nftMintStat.maxEpoch,
        }, {
            transaction: dbTx
        })
    }
}