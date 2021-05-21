import {DataTypes, Model} from "sequelize";

/**
 * list block mined by miner
 */
export interface IFullMinerBlock {
    minerId: number;
    epoch: number;
    position: number;
    createdAt: Date,
}

export class FullMinerBlock extends Model<IFullMinerBlock> implements IFullMinerBlock {
    minerId: number;
    epoch: number;
    position: number;
    createdAt: Date;

    static register(sequelize) {
        FullMinerBlock.init({
                minerId: DataTypes.BIGINT,
                epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
                position: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
                createdAt: {type: DataTypes.DATE, allowNull: false},
            }
            , {
                timestamps: false,
                sequelize: sequelize,
                tableName: 'full_miner_block',
                indexes: [
                    {
                        name: 'block_time_idx', // index name must be unique globally under sqlite.
                        fields: [{name: 'createdAt', order: 'DESC'}]
                    },
                    /*{
                    // It's primary key, created by SQL directly.
                        name: 'pk_minerId_epoch_bPos', unique: true,
                        fields:[
                            {name:'minerId', order: 'DESC'},
                            {name:'epoch', order: 'DESC'},
                            {name:'position', order: 'DESC'},
                        ],
                    }*/
                ]
            })
    }
}
