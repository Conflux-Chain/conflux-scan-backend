import {DataTypes, Model} from "sequelize";

export interface ITraceCreateContract{
    id?:number
    epochHeight:number
    txHashId?:number
    traceIndex?:number
    from:number
    value:number
    addr:number
    outcome:string
    blockTime:number
}
export class TraceCreateContract extends Model<ITraceCreateContract> implements ITraceCreateContract{
    id?:number
    epochHeight:number
    txHashId?:number
    traceIndex?:number
    from:number
    value:number
    addr:number
    outcome:string
    blockTime:number
    static register(seq){
        TraceCreateContract.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            epochHeight: {type: DataTypes.BIGINT, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            traceIndex: {type: DataTypes.BIGINT, allowNull: false},
            from: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
            addr: {type: DataTypes.BIGINT, allowNull: false},
            outcome: {type: DataTypes.CHAR(10), allowNull: false},
            blockTime: {type: DataTypes.BIGINT, allowNull: false},
        },{
            sequelize: seq,
            tableName: 'trace_create_contract',
            timestamps: false,
            indexes: [{
                name: "from_idx", fields: ["from"]
            }, {
                name: "addr_idx", fields: ["addr"], unique: true,
            }, {
                name: 'blockTime_idx', fields: [{name:'blockTime', order: "DESC"}]
            }]
        })
    }
}