import {init} from "../service/tool/FixDailyTokenStat";

process.env.TZ = 'UTC'
// create monitor data in influx DB.
import {FieldType, IHostConfig, InfluxDB} from 'influx'
import {TaskCfxTransfer} from "../CfxTransferSync";
import {EpochTaskTokenTransfer} from "../TokenTransferSync";
import {Epoch} from "../model/Epoch";
import {FullBlock} from "../model/FullBlock";
async function copy(inf: InfluxDB, model:any, biz, epochField: Function = (a)=>a.epoch) {
    // model = TaskCfxTransfer;
    const max = await model.findOne({order: [['epoch', 'desc']]})
    if (max === null) {
        console.log(` ${new Date().toISOString()} no data for ${biz}`)
        return;
    }
    console.log(` ${new Date().toISOString()} epoch ${epochField(max)}, time ${
        (max.createdAt || max.timestamp).toISOString()}, biz ${biz}`)
    return write(inf, measurement, {epoch: epochField(max), createdAt: max.createdAt || max.timestamp, biz})
}
async function copyAll(inf: InfluxDB) {
    await copy(inf, TaskCfxTransfer, 'task-cfx-x', a=>a.cursor)
    await copy(inf, EpochTaskTokenTransfer, 'task-token-x', a=>a.cursor)
    await copy(inf, Epoch, 'sync-epoch')
    await copy(inf, FullBlock, 'sync-block-and-tx')
    // influx worker itself
    await write(inf, measurement, {epoch: Date.now(), createdAt: new Date(), biz: 'influx-worker'})
    console.log(`---`)
}
class EpochMax {
    epoch: number; biz:string; createdAt: Date;
}
const measurement = 'sync_epoch_3';
function connectInflux({host, database, username, password}) {
    const influx = new InfluxDB({
        host,        database, username, password,
        schema: [
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
    const {host, database, username, password} = config.influxDB
    console.log(`influx db is ${host} ${database} user ${username}`)
    const inf = connectInflux({host, database, username, password})
    // await test(inf);
    await copyAll(inf)
    setInterval(()=>{
        copyAll(inf)
    }, 1000 * 60); // 1 minute
}

if (module === require.main) {
    setup().then()
}