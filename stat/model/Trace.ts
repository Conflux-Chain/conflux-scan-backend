import {DataTypes, Model} from "sequelize";

export interface ITrace{
    id?:number
    txId?:number
    from:number
    to:number
    value:number
    epochHeight:number
    blockTime: Date;
}
export class Trace extends Model<ITrace> implements ITrace{
    id?:number
    txId?:number
    from:number
    to:number
    value:number
    epochHeight:number
    blockTime: Date;
    static register(seq){
        Trace.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            txId: {type: DataTypes.BIGINT, allowNull: false},
            epochHeight: {type: DataTypes.BIGINT, allowNull: false},
            from: {type: DataTypes.BIGINT, allowNull: false},
            to: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
            blockTime: {type: DataTypes.DATE, allowNull: false},
        },{
            sequelize: seq,
            tableName: 'trace',
            timestamps: false,
            indexes: [{
                name: "from_idx", fields: ["from"]
            }, {
                name: "to_idx", fields: ["to"]
            }, {
                name: 'blockTime', fields: [{name:'blockTime', order: "DESC"}]
            }]
        })
    }
}