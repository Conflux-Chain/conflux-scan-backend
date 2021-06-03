import {Sequelize, DataTypes, Model} from "sequelize";

export interface IBlock {
    id: number;
    miner: string;
    hash: string;
    epoch: number;
    difficulty: number;
    totalReward: number;
}

export interface IBlockAttributes {
    minerId: number;
    hashId?: number;
    hash?: String;
    epoch: number;
    difficulty: number;
    createAt: Date,
    totalReward: bigint;
    txFee: bigint;
}

export class Block extends Model<IBlockAttributes> implements IBlockAttributes {
    epoch: number;
    createAt: Date;
    difficulty: number;
    minerId: number;
    hashId?: number;
    hash?: string;
    totalReward: bigint;
    txFee: bigint;

    static findMax() {
        return Block.scope("maxOneById").findOne()
    }

    static register(sequelize) {
        Block.init({
            difficulty: {type: DataTypes.BIGINT, allowNull: false, defaultValue: 0},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createAt: {type: DataTypes.DATE, allowNull: false},
            minerId: {type: DataTypes.BIGINT, allowNull: false},
            hashId: {type: DataTypes.BIGINT, allowNull: true, defaultValue: 0},
            hash: {type: DataTypes.CHAR(66), allowNull: true, defaultValue: ''},
            totalReward: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            txFee: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
        }, {
            tableName: 'block',
            sequelize,
            timestamps: false,
            indexes: [
                {
                    name: 'miner_idx',
                    fields: ['minerId']
                },{
                    name: 'block_time_idx', // index name must be unique globally under sqlite.
                    fields: [{name: 'createAt', order: 'DESC'}]
                },{
                    name: 'block_hash',
                    fields:[{name:'hash', length:10}]
                }
            ],
            scopes: {
                maxOneById: {
                    limit: 1,
                    order: [["id", "desc"]]
                },
            }
        })
    }
}

export interface IPivotSwitch{
    id?:number
    high:number
    low:number
    preConfirmed:number,
    preExecuted:number,
    revertConfirmed:boolean
    revertExecuted:boolean
    revertDepth:number
}
export class PivotSwitch extends Model<IPivotSwitch> implements IPivotSwitch{
    id?:number
    high:number
    low:number
    preConfirmed:number
    preExecuted:number
    revertConfirmed:boolean
    revertExecuted:boolean
    revertDepth:number
    static register(seq:Sequelize){
        PivotSwitch.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            high: {type: DataTypes.BIGINT, allowNull:false},
            low: {type: DataTypes.BIGINT, allowNull:false},
            preConfirmed: {type: DataTypes.BIGINT, allowNull:false},
            preExecuted: {type: DataTypes.BIGINT, allowNull:false},
            revertConfirmed: {type: DataTypes.BOOLEAN, allowNull:false},
            revertExecuted: {type: DataTypes.BOOLEAN, allowNull:false},
            revertDepth: {type: DataTypes.BOOLEAN, allowNull:false, defaultValue: false},
        },{
            sequelize: seq,
            tableName: 'pivot_switch',
            timestamps: true,
            createdAt: true,
            updatedAt: false,
            indexes:[
                {
                    name: 'idx_time', fields:[
                        {name: "createdAt", order:"DESC"}
                    ]
                }
            ]
        })
    }
}