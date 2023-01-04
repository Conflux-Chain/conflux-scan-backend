import { DataTypes, Model, Sequelize} from "sequelize";

export interface IPrune {
    id?: number
    addressId: number
    type: string
    pruned: number
    epoch: number
    updatedAt: Date;
}

export class PruneInfo extends Model<IPrune> implements IPrune {
    id?: number
    addressId: number
    type: string
    pruned: number
    epoch: number
    updatedAt: Date;
    static register(seq: Sequelize) {
        PruneInfo.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            type: {type: DataTypes.CHAR(16), allowNull: false},
            pruned: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq,
            tableName: "prune_info",
            timestamps: true,
            indexes: [
                {
                    name: "idx_addr_type",
                    fields: ["addressId", "type"],
                    unique: true,
                },
            ],
        })
    }
}

export enum PruneType {
    BLOCK = 'BL', MINER_BLOCK = 'AD_BL',
    TX = 'TX', ADDR_TX = 'AD_TX',

    CFX_TRANSFER = 'TS_CFX_2', ADDR_CFX_TRANSFER = 'AD_TS_CFX_2',

    ERC20_TRANSFER = 'TS_20_2', ADDR_ERC20_TRANSFER = 'AD_TS_20_2',
    ERC721_TRANSFER = 'TS_721_2', ADDR_ERC721_TRANSFER = 'AD_TS_721_2',
    ERC1155_TRANSFER = 'TS_1155_2', ADDR_ERC1155_TRANSFER = 'AD_TS_1155_2',
    ERC3525_TRANSFER = 'TS_3525_2', ADDR_ERC3525_TRANSFER = 'AD_TS_3525_2',

    ADDR_TRANSFER = 'AD_TS_2',
}
