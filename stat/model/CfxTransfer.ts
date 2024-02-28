import {DataTypes, fn, Model, Op, Sequelize, QueryTypes} from "sequelize";
import {batchBuildId, buildHexSet, fillHexId, Hex64Map, makeId} from "./HexMap";
import {createTable} from "../service/DBProvider";
import {KEY_FULL_CFX_TRANSFER_COUNT, KV} from "./KV";
import {EpochCfxTransferCount} from "../CfxTransferSync";

// ============= partition by address table ==============
export interface IAddressCfxTransfer {
    addressId: number
    epoch: number
    blockIndex: number;
    txIndex: number;
    txLogIndex: number
    createdAt: Date
    fromId: number
    toId: number
    value: number
    type:string
}
export const T_ADDRESS_CFX_TRANSFER = 'address_cfx_transfer_2'
export const T_ADDRESS_CFX_TRANSFER_SQL = `
create table if not exists ${T_ADDRESS_CFX_TRANSFER}
(
 \`addressId\` bigint(20) unsigned NOT NULL,
 \`epoch\` bigint(20) unsigned NOT NULL,
   \`blockIndex\` int unsigned NOT NULL,
  \`txIndex\` mediumint unsigned NOT NULL,
  \`txLogIndex\` mediumint unsigned NOT NULL,
 \`createdAt\` datetime NOT NULL,
 \`fromId\` bigint(20) unsigned NOT NULL,
 \`toId\` bigint(20) unsigned NOT NULL,
 \`value\` decimal(36) NOT NULL,
 \`type\` varchar (128) NOT NULL default '',
  PRIMARY KEY (\`addressId\` DESC, \`epoch\` DESC, \`blockIndex\` desc, txIndex desc, txLogIndex desc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8
partition by hash (addressId)
  PARTITIONS 97;
`

export async function createAddressCfxTransferTable(seq:Sequelize) {
    return createTable(seq, T_ADDRESS_CFX_TRANSFER_SQL)
    .then(()=>{
        return AddressCfxTransfer.register(seq)
    }).then(()=>{
        AddressCfxTransfer.removeAttribute("id")
    }).catch(err=>{
        console.log(`createAddressCfxTransferTable fail, sql ${T_ADDRESS_CFX_TRANSFER_SQL}:`, err)
        process.exit(9)
    })
}

export class AddressCfxTransfer extends Model<IAddressCfxTransfer> implements IAddressCfxTransfer {
    addressId: number
    epoch: number
    createdAt: Date
    blockIndex: number;
    txIndex: number;
    txLogIndex: number
    fromId: number
    toId: number
    value: number
    type:string
    static register(seq) {
        AddressCfxTransfer.init(
            {
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
            type: {type: DataTypes.STRING(128), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_CFX_TRANSFER,
            indexes: [
            ],
        })
    }
}

export function buildAddressCfxTransfer(row:any, addrId:number) : any {
    return {
        addressId: addrId, epoch: row.epoch, createdAt: row.createdAt,
        fromId: row.fromId, toId: row.toId,  value: row.value,
        blockIndex: row.blockIndex, //
        txIndex: row.transactionIndex,
        txLogIndex: row.txLogIndex,
    }
}

// ============= full table paging ==============
export interface ICfxTransferRowMark {
    id: number // row id
    epoch: number
    dataId: number // refer to cfx_transfer.id
}
export class CfxTransferRowMark extends Model<ICfxTransferRowMark> implements ICfxTransferRowMark{
    id: number // row id
    epoch: number
    dataId: number // refer to cfx_transfer.id
    static register(seq) {
        CfxTransferRowMark.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, primaryKey: true},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            dataId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
        },{
            sequelize: seq,
            timestamps: false,
            tableName: 'cfx_transfer_row_mark_2',
            indexes:[
            ]
        })
    }
}

export const CFX_TRANSFER_PAGE_MARK_SIZE = 10_000
export async function markCfxTransferPosition(count:number=1, maxEpoch:number=Infinity, showLog = false) {
    let maxOne:ICfxTransferRowMark = await CfxTransferRowMark.findOne({order:[["id","desc"]], limit: 1})
    if (maxOne === null) {
        maxOne = {id:0, epoch: -1, dataId: -1}
    }
    do {
        const higherAnchor = await CfxTransfer.findOne({
            order: [["epoch", "asc"], ["id", "asc"]],
            where: buildHigherCfxTransferRowCondition(maxOne),
            // minus 1 will make the target record be the PAGE_MARK_SIZE(th) one.
            offset: CFX_TRANSFER_PAGE_MARK_SIZE - 1,
            // logging: console.log, benchmark: true
        })
        if (higherAnchor === null) {
            console.log(`\nCfx transfer Higher anchor not found, want higher than: epoch ${maxOne.epoch
            } dataId ${maxOne.dataId}`)
            return
        } else if (higherAnchor.epoch > maxEpoch) {
            showLog && console.log(`cfx transfer: reach max epoch, reOrg may occur, stop marking. ${higherAnchor.epoch} > ${maxEpoch}`)
            return ;
        }
        const saved = await CfxTransferRowMark.create({
            id: maxOne.id + CFX_TRANSFER_PAGE_MARK_SIZE,
            epoch: higherAnchor.epoch, dataId: higherAnchor.id
        });
        maxOne = saved
        showLog && process.stdout.write(`\r\u001b[2K markCfxTransferPosition ${count} ${JSON.stringify(saved)}`)
    } while (--count>0)
    showLog && console.log(`\n markCfxTransferPosition done.`)
}

export class CfxTransferPage {
    id:number
    epoch:number
    dataId:number
    skip:number
    nonMarkRows:number
    calcTotal:number //nonMarkRow+id
}
export async function pagingFullCfxTransfer(skip:number, logger: any = undefined) : Promise<CfxTransferPage> {
    // find the max mark
    const maxOne = await CfxTransferRowMark.findOne({order:[["id","desc"]], limit: 1})
    // handle null
    if (maxOne === null) {
        return {id:Infinity, epoch:Infinity, dataId:Infinity, skip, nonMarkRows:-1, calcTotal: -1}
    }
    // calculate rows between max mark and latest block
    const nonMarkRows = await countNonMarkCfxTransferRows(maxOne);
    if (nonMarkRows >= skip) {
        return {id:Infinity, epoch:Infinity, dataId:Infinity, skip, nonMarkRows, calcTotal: nonMarkRows+maxOne.id}
    }

    const pagedSkip = skip - nonMarkRows
    const skipMarkRows = Math.floor(pagedSkip/CFX_TRANSFER_PAGE_MARK_SIZE)
    if (skipMarkRows === 0) {
        return {
            id: maxOne.id,
            epoch: maxOne.epoch,
            dataId: maxOne.dataId,
            skip: pagedSkip, nonMarkRows, calcTotal: nonMarkRows+maxOne.id
        };
    }
    const nearestId = maxOne.id - CFX_TRANSFER_PAGE_MARK_SIZE * skipMarkRows
    // find the min mark that greater than pagedSkip
    const nearestOne = await CfxTransferRowMark.findByPk(nearestId)
    if (nearestOne === null) {
        return {
            id: -1,
            epoch: -1,
            dataId: -1,
            skip: pagedSkip, nonMarkRows, calcTotal: nonMarkRows+maxOne.id
        }; // should found nothing.
    }
    // must exists
    const remainSkip = pagedSkip - CFX_TRANSFER_PAGE_MARK_SIZE * skipMarkRows;
    console.log(`cfx transfer : want skip ${skip},has total ${nonMarkRows+maxOne.id} nonMarkRows ${nonMarkRows}, max id ${maxOne.id}, pagedSkip ${pagedSkip
    } skipMarkRows ${skipMarkRows}, nearestId ${nearestId}, remain ${remainSkip}`)
    return {
        id: nearestOne.id,
        epoch: nearestOne.epoch,
        dataId: nearestOne.dataId,
        skip: remainSkip
        , nonMarkRows, calcTotal: nonMarkRows+maxOne.id
    };
}

function buildHigherCfxTransferRowCondition(maxOne: ICfxTransferRowMark) {
    return {
        [Op.or]: {
            epoch: {[Op.gt]: maxOne.epoch},
            [Op.and]: {
                epoch: {[Op.eq]: maxOne.epoch},
                id: {[Op.gt]: maxOne.dataId},
            }
        }
    };
}

export async function countNonMarkCfxTransferRows(maxOne: ICfxTransferRowMark) {
    const nonMarkRows = await CfxTransfer.count({
        where: buildHigherCfxTransferRowCondition(maxOne),
        // logging: console.log
    })
    return nonMarkRows;
}

export async function checkCfxTransferCountKV() {
    const cnt = await KV.getNumber(KEY_FULL_CFX_TRANSFER_COUNT, NaN)
    if (!isNaN(cnt)) {
        // logger?.info({src: `checkCfxTransferCountKV------------`, msg:`count cfx-transfer in KV:${cnt}`});
        return
    }

    const maxCfxTransfer = await CfxTransfer.findOne({order:[['id','desc']], limit: 1})
    if (maxCfxTransfer === null) {
        // logger?.info({src: `checkCfxTransferCountKV------------`, msg:`count cfx-transfer:0, as no value in KV`});
        return KV.create({key: KEY_FULL_CFX_TRANSFER_COUNT, value: '0'})
    }

    if (maxCfxTransfer.id < CFX_TRANSFER_PAGE_MARK_SIZE) {
        let countNow = (await CfxTransfer.count()).toString();
        // logger?.info({src: `checkCfxTransferCountKV------------`, msg:`count cfx-transfer:${countNow}, as system just starts.`});
        return KV.create({key: KEY_FULL_CFX_TRANSFER_COUNT, value: countNow});
    }

    let maxOne:ICfxTransferRowMark = await CfxTransferRowMark.findOne({order: [["id", "desc"]], limit: 1});
    if (maxOne === null) {
        maxOne = {id:0, epoch:-1, dataId: -1}
    }
    const nonMarkRows = await countNonMarkCfxTransferRows(maxOne);
    const countNow = nonMarkRows + maxOne.id;
    // logger?.info({src: `checkCfxTransferCountKV------------`, msg: `count cfx-transfer:${countNow}, non-mark rows:${nonMarkRows}, mark-rows:${maxOne.id}`});
    return KV.create({key: KEY_FULL_CFX_TRANSFER_COUNT, value: countNow.toString()});
}

// ============= full table ==============
export interface ICfxTransfer {
    id?: number // data is fixed at a delayed time, so id is not consistent with epoch.
    epoch: number
    createdAt: Date
    blockIndex: number;
    txIndex: number;
    txLogIndex: number
    fromId: number
    toId: number
    value: number
    type:string
}
// ======================== fix backup
export interface IBakCfxTransfer {
    id?: number
    epoch: number
    createdAt: Date
    blockIndex: number;
    txIndex: number;
    txLogIndex: number
    fromId: number
    toId: number
    value: number
    type:string
}
export class BakCfxTransfer extends Model<IBakCfxTransfer> implements IBakCfxTransfer {
    id?: number
    epoch: number
    createdAt: Date
    blockIndex: number;
    txIndex: number;
    txLogIndex: number
    fromId: number
    toId: number
    value: number
    type:string
    static register(seq) {
        BakCfxTransfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
            type: {type: DataTypes.STRING(128), allowNull: false, defaultValue: ''},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: 'bak_cfx_transfer',
            indexes: [
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
            ],
        })
    }
}
// ======================== fix backup , end
export const T_CFX_TRANSFER = 'cfx_transfer_2'
export class CfxTransfer extends Model<ICfxTransfer> implements ICfxTransfer {
    id?: number
    epoch: number
    createdAt: Date
    blockIndex: number;
    txIndex: number;
    txLogIndex: number
    fromId: number
    toId: number
    value: number
    type:string
    static register(seq) {
        CfxTransfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
            type: {type: DataTypes.STRING(128), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_CFX_TRANSFER,
            indexes: [
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
                {
                    name: 'idx_datetime',
                    fields: [{name: 'createdAt', order: "DESC"}]
                },
            ],
        })
    }
}

function buildCfxTransfer(obj, date) {
    /*
    const start = Date.now()
    const [fromId, toId] = await Promise.all([
        makeId(obj.from, undefined, {dt:date}).then(res=>{metrics.makeIdMs1 += Date.now() - start; return res;}),
        makeId(obj.to, undefined, {dt:date}).then(res=>{metrics.makeIdMs2 += Date.now() - start; return res;}),
        //makeId(obj.transactionHash).then(res=>{metrics.makeIdMs3 += Date.now() - start; return res;}),
    ])

     */
    let cfxTransfer:ICfxTransfer = {
        blockIndex: obj.blockIndex, //
        txIndex: obj.transactionIndex,
        fromId: obj.fromId,//fromId.id,
        toId: obj.toId,//toId.id,
        value: obj.value || 0,
        createdAt: date,
        epoch: obj.epochNumber,
        txLogIndex: obj.transactionTraceIndex,
        type: obj.type,
    };
    return cfxTransfer
}
const metrics = {
    count: 0,
    sumMs: 0,
    transferCnt:0,
    partitionCnt: 0,
    buildMs1: 0,
    buildMs2: 0,
    saveFullMs: 0,
    savePartitionMs: 0,
    upCntMs: 0,
    markMs: 0,
    commitMs: 0, dbMs: 0,
    makeIdMs1: 0,
    makeIdMs2: 0,
    makeIdMs3: 0,
    reset: function () {
        metrics.count = metrics.sumMs = metrics.buildMs1 = metrics.buildMs2 = 0
        metrics.savePartitionMs = metrics.saveFullMs = metrics.upCntMs = metrics.markMs = 0
        metrics.transferCnt = metrics.partitionCnt = metrics.commitMs = metrics.dbMs = 0
        metrics.makeIdMs1 = metrics.makeIdMs2 = metrics.makeIdMs3 = 0
    }
}
async function buildFromToId(array, dt:Date) {
    const hexSet = buildHexSet(undefined, array, 'from')
    buildHexSet(hexSet, array, 'to')
    const tasks = []
    hexSet.forEach(hex=>tasks.push(makeId(hex, undefined, {dt})))
    const hexMap = await Promise.all(tasks).then(hexArr=>{
        const map = new Map<string, number>()
        hexArr.forEach(bean => map.set(bean.hex, bean.id))
        return map;
    })
    fillHexId(hexMap, array, 'from', 'fromId')
    fillHexId(hexMap, array, 'to', 'toId')
    return hexMap.values()
}

export async function doMark(rows, epoch, logger){
    const [oldValue, newValue] = rows;
    const oldPage = Math.floor(oldValue / CFX_TRANSFER_PAGE_MARK_SIZE);
    const newPage = Math.floor(newValue / CFX_TRANSFER_PAGE_MARK_SIZE);
    // logger?.info({src: `batchSaveCfxTransfer-2------------`, 'oldPage': oldPage, 'newPage': newPage});
    if ( newPage > oldPage) {
        let avoidReOrg = 1000;
        return markCfxTransferPosition(CFX_TRANSFER_PAGE_MARK_SIZE, epoch - avoidReOrg);
    }
    return Promise.resolve(0);
}

export async function popPartitionCfxTransfer(epoch, logger = undefined, dbTx = undefined){
    const cfxTransferArray = await CfxTransfer.findAll({where: {epoch}});
    if(!cfxTransferArray?.length){
        return Promise.resolve();
    }

    const addressIds = new Set<number>()
    cfxTransferArray.forEach(row => {
        addressIds.add(row.fromId);
        addressIds.add(row.toId);
    })

    return Promise.all([
            AddressCfxTransfer.destroy({
                where: { epoch, addressId: {[Op.in]: [...addressIds]} },
                transaction: dbTx
            }),
            // KV.diffCount(KEY_FULL_CFX_TRANSFER_COUNT, -cfxTransferArray.length, dbTx),
            CfxTransfer.destroy({where: {epoch}, transaction: dbTx}),
            EpochCfxTransferCount.create({epoch, n: -cfxTransferArray.length}, {
                transaction: dbTx
            })
        ]);
        // logger?.info({src: `batchPopCfxTransfer------------`, 'resultArray': JSON.stringify(resultArray)});

}

// ============= daily cfx transfer ==============
export const T_DAILY_CFX_TXN = 'daily_cfx_txn'
export interface IDailyCfxTxn {
    id?:number
    txnCount:number
    userCount:number
    amount:number
    day:Date
}
export class DailyCfxTxn extends Model<IDailyCfxTxn> implements IDailyCfxTxn{
    id?:number
    txnCount:number
    userCount:number
    amount:number
    day:Date
    static register(seq){
        DailyCfxTxn.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            txnCount: {type: DataTypes.BIGINT, allowNull: false},
            userCount: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, defaultValue: 0},
            amount: {type: DataTypes.DECIMAL(56,0), allowNull: false, defaultValue: 0},
            day: {type: DataTypes.DATEONLY, allowNull: false, unique: true},
        },{
            tableName: T_DAILY_CFX_TXN,
            sequelize: seq,
            indexes:[
                {name: 'idx_day', fields: [{name: 'day', order: "DESC"}]}
            ]
        })
    }
}
export async function calcUniqueUser(start:Date, end:Date, model: any) : Promise<number> {
    const t = model.getTableName()
    const sql = `select count(*) as cnt from (
        select fromId from ${t} where createdAt between ? and ?
     union 
        select toId from ${t} where createdAt between ? and ?
    ) t`
    return model/*CfxTransfer*/.sequelize.query(sql,
        {type:QueryTypes.SELECT, replacements: [start, end, start, end]}
        ).then(arr=>{
        return Number(arr[0]['cnt'])
    })
}
export async function rollupDailyCfxTxn(dt:Date) {
    dt.setHours(0,0,0,0)
    let end = new Date(dt)
    end.setHours(23,59,59,999)
    let [transferCount, userCount, amount] = await Promise.all([
        CfxTransfer.count({        where:{
            createdAt: {[Op.between]:[dt, end]}
        }    }),
        calcUniqueUser(dt, end, CfxTransfer),
        CfxTransfer.sum('value', {
            where: {createdAt:{[Op.between]:[dt, end]}}
        })
    ])
    await DailyCfxTxn.upsert({
        txnCount: transferCount, day: dt,
        userCount, amount: amount ?? 0
    })
}

export async function rollupDailyCfxTxnCurrent() {
    const cur = new Date()
    if (cur.getHours() === 0 && cur.getMinutes() < 30) {
        // rollup previous day, time point is an hour ago.
        await rollupDailyCfxTxn(new Date(cur.getTime() - 1000*3600))
    }
    await rollupDailyCfxTxn(cur);
}

export async function scheduleRollupDailyCfxTxn() {
    await rollupDailyCfxTxnCurrent()
    setTimeout(scheduleRollupDailyCfxTxn, 1000*60*10)// ten minutes
}

export async function sumRecentCfxTxn(days:number) : Promise<number> {
    return DailyCfxTxn.findAll({limit:days, order:[['day','desc']]})
        .then(arr=>arr.map(row=>row.txnCount).reduce((a,b)=>a+b, 0))
}

export async function sumRecentCfxAmount(days:number) : Promise<any> {
    return DailyCfxTxn.findAll({limit:days, order:[['day','desc']]})
        .then(arr=>arr.map(row=>BigInt(row.amount)).reduce((a,b)=>{
            return a+b;
        }, BigInt(0)))
}
