import {init} from "../service/tool/FixDailyTokenStat";

process.env.TZ = 'UTC'
// create monitor data in influx DB.
import {FieldType, IHostConfig, InfluxDB, ISingleHostConfig} from 'influx'
import {Epoch} from "../model/Epoch";
import {FullBlock} from "../model/FullBlock";
import {HeartBeatBean} from "../model/HeartBeat";
import {KV} from "../model/KV";
import {Op} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "../service/common/utils";
import {EpochHashCfxTransfer} from "../CfxTransferSync";
import {EpochHashTokenTransfer} from "../TokenTransferSync";

let cfx: Conflux;

async function copy(inf: InfluxDB, model:any, biz, epochField: Function = (a)=>a.epoch) {
    const max = await model.findOne({order: [['epoch', 'desc']]})
    if (max === null) {
        console.log(` ${new Date().toISOString()} no data for ${biz}`)
        return;
    }
    console.log(` ${new Date().toISOString()} epoch ${epochField(max)}, time ${
        (max.createdAt || max.timestamp).toISOString()}, biz ${biz}`)
    return write(inf, measurement, {epoch: epochField(max), createdAt: max.createdAt || max.timestamp, biz})
}
async function heartBeat(inf: InfluxDB) {
    const arr = await HeartBeatBean.findAll()
    const measureArr = arr.map(bean=>{
        return {
            measurement,
            tags: { biz: bean.key, },
            fields: {
                epoch: bean.updatedAt.getTime(),
                createdAt: bean.updatedAt.getTime(),
                biz: bean.key
            },
        }
    })

    return inf.writePoints(measureArr).catch(err=>{
        console.log(`heart beat want write:`, measureArr, err)
    })
}
// not used for now
async function epochCursorInConfig(inf: InfluxDB) {
    const arr = await KV.findAll({where: {key:{[Op.in]: [
        '',
                ]}}})
    const now = Date.now();
    const measureArr = arr.map(bean=>{
        return {
            measurement,
            tags: { biz: bean.key, },
            fields: {
                epoch: parseInt(bean.value),
                createdAt: now,
                biz: bean.key
            },
        }
    })

    return inf.writePoints(measureArr).catch(err=>{
        console.log(`epochCursorInConfig want write:`, measureArr, err)
    })
}
async function copyAll(inf: InfluxDB) {
    await copy(inf, EpochHashCfxTransfer, 'task-cfx-x')
    await copy(inf, EpochHashTokenTransfer, 'task-token-x')
    await copy(inf, Epoch, 'sync-epoch')
    await copy(inf, FullBlock, 'sync-block-and-tx')
    // influx worker itself
    await write(inf, measurement, {epoch: Date.now(), createdAt: new Date(), biz: 'influx-worker'});
    await cfx.getEpochNumber().then(res=>{
        return write(inf, measurement, {epoch: res, createdAt: new Date(), biz: 'chain-height'});
    }).catch(e=>{
        console.log(`failed to get epoch number`, e)
    })
    await heartBeat(inf)
    // await epochCursorInConfig(inf)
    console.log(`---`)
}
class EpochMax {
    epoch: number; biz:string; createdAt: Date;
}

export const SyncBlockSchema = {
    fields: {
        biz: FieldType.STRING,
        epochPerStat: FieldType.INTEGER,
        batchSize: FieldType.INTEGER,

        epoch: FieldType.INTEGER,
        ms : FieldType.INTEGER,
        bulkSaveMs: FieldType.INTEGER,
        executedTxCount : FieldType.INTEGER,
        addressTxCount: FieldType.INTEGER,
        blockCount: FieldType.INTEGER,
        //
        queryFullNodeTime: FieldType.INTEGER,
        pureRpcTime: FieldType.INTEGER,
        procTime: FieldType.INTEGER,
        buildTime: FieldType.INTEGER,
        saveBlockTime: FieldType.INTEGER,
        saveTxTime: FieldType.INTEGER,
        saveAddrTxTime: FieldType.INTEGER,
        diffBlockCntTime: FieldType.INTEGER,
        diffTxCntTime: FieldType.INTEGER,
    },
    tags: [
        'biz'
    ]
}

export class SyncReporter {
    influxDB?: ISingleHostConfig & {measurement: string, disable?: boolean}
    private inf: InfluxDB;
    constructor(influxDB?: ISingleHostConfig & {measurement: string, disable?: boolean}) {
        this.influxDB = influxDB;
        measurement = influxDB.measurement || measurement;
    }
    connect(schema?: any) {
        if (this.influxDB.disable) {
            return
        }
        this.inf = connectInflux(this.influxDB as any, schema);
    }
    write(row:any) {
        if (!this.inf) {
            return
        }
        write(this.inf, measurement, row).catch(e=>{
            console.log(`${__filename} failed to write metrics:`, e);
        });
    }
}

let measurement = 'sync_epoch_3';
function connectInflux({host, database, username, password,  port, protocol}, schema?:any) {
    const influx = new InfluxDB({
        host,        database, username, password, port, protocol,
        schema: [
            schema ? {...schema, measurement} :
            {
                measurement,
                fields: {
                    epoch: FieldType.INTEGER,
                    createdAt: FieldType.STRING,
                    biz: FieldType.STRING,
                },
                tags: [
                    'biz'
                ]
            }
        ]
    })
    return influx;
}
async function write(influx, measurement, row: EpochMax) {
    const bean = {
        measurement,
        tags: { biz: row.biz, },
        fields: row,
    };
    return influx.writePoints([
        bean
    ]).catch(err=>{
        console.log(`want write:`, bean)
        throw err
    })
}
async function query(inf: InfluxDB, t: string, where:string) {
    const sql = `select * from ${t} where ${where}`
    console.log(`sql : ${sql}`)
    const result = await inf.query(sql)
    console.log(` result :`, result)
}
async function test(inf: InfluxDB) {
    // const dbs = await inf.getDatabaseNames();
    // console.log(`dbs is : `, dbs)
    const result = await write(inf, measurement, {epoch: 1, biz: 'test-', createdAt: new Date()})
    console.log(`write result :`, result)
    await query(inf, measurement, '1=1')
}

async function setup() {
    // host = 'http://influxdb-luhhh4.conflux-chain.org.cn'
    const config = await init();
    console.log(`------init done-----`)
    cfx = await initCfxSdk(config.conflux);
    const {host, database, username, password,  port, protocol, measurement: confMeasurement} = config.influxDB
    if (confMeasurement) {
        measurement = confMeasurement
    }
    console.log(`influx db is ${host} ${database} user ${username} measurement ${measurement}`)
    const inf = connectInflux({host, database, username, password,  port, protocol});
    // await test(inf);
    await copyAll(inf)
    setInterval(()=>{
        copyAll(inf)
    }, 1000 * 60); // 1 minute
}

if (module === require.main) {
    setup().then()
}
