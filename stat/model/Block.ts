import {Sequelize, DataTypes, Model} from "sequelize";

export interface IBlock {
    id: number;
    miner: string;
    hash: string;
    epoch: number;
    difficulty: number;
    totalReward: number;
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
            tableName: 'pivot_switch_2',
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