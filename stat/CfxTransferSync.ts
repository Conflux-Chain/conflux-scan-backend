import {Transaction, Model,DataTypes, Sequelize, Op, UniqueConstraintError, ModelStatic} from "sequelize";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {Measure} from "./service/common/Measure";
import {IEpochTask} from "./service/UniqueAddressStat";

interface IEpochHashCfxTransfer {
    epoch:number
    hash:string
}

// used to find parent hash when popping
export class EpochHashCfxTransfer extends Model<IEpochHashCfxTransfer>
    implements IEpochHashCfxTransfer{
    epoch:number
    hash:string
    static register(seq: Sequelize) {
        EpochHashCfxTransfer.init({
            epoch : {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true},
            hash: {type: DataTypes.CHAR(66), allowNull: false},
        },{
            sequelize: seq, tableName: 'epoch_hash_cfx_transfer',
            updatedAt: false,
        })
    }
}
export interface ITaskCfxTransfer extends IEpochTask {
    cursor:number
    pivotHash: string
    checkPivot?: boolean
}
// task table.
export class TaskCfxTransfer extends Model<ITaskCfxTransfer> implements ITaskCfxTransfer{
    epoch: number
    range: number
    createdAt: Date
    updatedAt: Date
    finished: boolean

    cursor: number;
    pivotHash: string
    static register(seq: Sequelize) {
        TaskCfxTransfer.init({
            epoch: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            cursor: {type: DataTypes.BIGINT, allowNull: false},
            range: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            finished: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
            pivotHash: {type: DataTypes.CHAR(66), allowNull: false},
        },{
            sequelize: seq, tableName: 'task_cfx_transfer',
        })
    }
}
async function decodeTransferFromTraces(){

}

if (module === require.main) {
    const [, , cfxUrl, fromEpoch, taskLen] = process.argv

}