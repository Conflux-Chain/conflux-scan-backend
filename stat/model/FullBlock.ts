/** Save all block. Another model `Block` only saves recent blocks (miner stat)*/



import {Sequelize, DataTypes, Model} from "sequelize";

export interface IFullBlock {
    id? :number;
    epoch: number;
    position: number;
    hash: string;
    difficulty: number;
    minerId: number;
    createAt: Date,
    totalReward: bigint;
    txFee: bigint;
    avgGasPrice: number;
    gasLimit: number;
    gasUsed:number;
    txCount:number;
    pivot: boolean;
}

export class FullBlock extends Model<IFullBlock> implements IFullBlock {
    epoch: number;
    createAt: Date;
    difficulty: number;
    minerId: number;
    hash: string;
    totalReward: bigint;
    txFee: bigint;
    avgGasPrice: number;
    gasLimit: number;
    gasUsed:number;
    txCount:number;
    pivot: boolean;
    position: number;
    static findMax() {
        return FullBlock.scope("maxOneById").findOne()
    }

    static register(sequelize) {
        // mysql partition limits that :
        // A primary must include all columns in the table's partitioning location.
        FullBlock.init({
            // id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            createAt: {type: DataTypes.DATE, allowNull: false},
            txCount: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0}, // A 32 bit integer.
            position: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
            pivot: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: 0},
            difficulty: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            minerId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            hash: {type: DataTypes.CHAR(66), allowNull: true, defaultValue: ''},
            totalReward: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            txFee: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            avgGasPrice: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0}, // sum(gasPrice of tx) / txCount
            gasLimit: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            gasUsed: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
        }, {
            tableName: 'full_block',
            sequelize,
            timestamps: false,
            indexes: [
                {
                    name: 'idx_minerId', // index name must be unique globally under sqlite.
                    fields: [{name: 'minerId', order: 'DESC'}]
                },
                {
                    name: 'idx_block_time', // index name must be unique globally under sqlite.
                    fields: [{name: 'createAt', order: 'DESC'}]
                },{
                    name: 'block_hash',
                    fields:[{name:'hash', length:10}]
                },
                /*{
                // It's primary key, created by SQL directly.
                    name: 'uk_epoch_pos', unique: true,
                    fields:[
                        {name:'epoch', order: 'DESC'},
                        {name:'position', order: 'DESC'},
                    ],
                }*/
            ],
            scopes: {
                maxOneById: {
                    limit: 1,
                    order: [["epoch", "desc", "position", "desc"]]
                },
            }
        })
    }
}
