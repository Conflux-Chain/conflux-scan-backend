import {DataTypes, Model} from "sequelize";

export interface ITraceCreateContract{
    id?:number
    epochNumber:number
    txHashId?:number
    txHash?:string
    traceIndex?:number
    from:number
    value:number
    to:number
    outcome:string
    blockTime:number
    codeHash?:string
}
export class TraceCreateContract extends Model<ITraceCreateContract> implements ITraceCreateContract{
    id?:number
    epochNumber:number
    txHashId?:number
    txHash?:string
    traceIndex?:number
    from:number
    value:number
    to:number
    outcome:string
    blockTime:number
    codeHash?:string
    static register(seq){
        TraceCreateContract.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            epochNumber: {type: DataTypes.BIGINT, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            txHash: {type: DataTypes.CHAR(64), allowNull: true},
            traceIndex: {type: DataTypes.BIGINT, allowNull: false},
            from: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
            to: {type: DataTypes.BIGINT, allowNull: false},
            outcome: {type: DataTypes.CHAR(10), allowNull: true},
            blockTime: {type: DataTypes.BIGINT, allowNull: false},
            codeHash: {type: DataTypes.CHAR(66), allowNull: true},
        },{
            sequelize: seq,
            tableName: 'trace_create_contract',
            timestamps: false,
            indexes: [{
                name: "from_idx", fields: ["from"]
            }, {
                name: "to_idx", fields: ["to"], unique: true,
            }, {
                name: 'blockTime_idx', fields: [{name:'blockTime', order: "DESC"}]
            }]
        })
    }
}

export interface IContractDestroy{
    id?:number
    epochNumber:number
    blockTime:Date
    txHash:string
    admin:string
    contract:string
}
export class ContractDestroy extends Model<IContractDestroy> implements IContractDestroy{
    id?:number
    epochNumber:number
    blockTime:Date
    txHash:string
    admin:string
    contract:string
    static register(seq){
        ContractDestroy.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false, autoIncrement: true},
            epochNumber: {type: DataTypes.BIGINT, allowNull: false},
            blockTime: {type: DataTypes.DATE, allowNull: false},
            txHash: {type: DataTypes.CHAR(64), allowNull: false},
            admin: {type: DataTypes.CHAR(40), allowNull: false},
            contract: {type: DataTypes.CHAR(40), allowNull: false},
        },{
            sequelize: seq,
            tableName: 'contract_destroy',
            timestamps: false,
            indexes: [{
                name: "admin_idx", fields: ["admin"]
            }, {
                name: "contract_idx", fields: ["contract"], unique: true,
            }, {
                name: 'blockTime_idx', fields: [{name:'blockTime', order: "DESC"}]
            }]
        })
    }
}