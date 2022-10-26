import {createClient} from 'redis';
import {RedisConf} from "../../config/StatConfig";
import {sleep} from "../tool/ProcessTool";
import {redisWrap} from "../RedisWrap";

export const STREAM_STAT_TOKEN_TRANSFER_Q = 'STREAM_STAT_TOKEN_TRANSFER_Q';
export const STREAM_STAT_ADDR_TRANSACTION_Q = 'STREAM_STAT_ADDR_TRANSACTION_Q';
export const STREAM_STAT_ADDR_CFX_TRANSFER_Q = 'STREAM_STAT_ADDR_CFX_TRANSFER_Q';
export const STREAM_STAT_DAILY_CFX_TRANSFER_Q = 'STREAM_STAT_DAILY_CFX_TRANSFER_Q';
export const STREAM_STAT_DAILY_TOKEN_TRANSFER_Q = 'STREAM_STAT_DAILY_TOKEN_TRANSFER_Q';
export const STREAM_STAT_MINER_BLOCK_Q = 'STREAM_STAT_MINER_BLOCK_Q';

export const HASH_CUSTODIAN_TOKEN = 'CUSTODIAN_TOKEN';
export const PRUNE_Q = 'PRUNE_Q_2';
export const TPS_TRANSFER_Q = 'TPS_TRANSFER_Q';
export const POW_EPOCH_FOR_POS_Q = 'POW_EPOCH_FOR_POS_Q';
export const CHANNEL_TEST = 'test';

export class RedisStack {

    // --------------------------- connect method ----------------------------
    static async connect(redisConf: RedisConf){
        redisStack.client = createClient({
            url: `redis://:${redisConf.pwd}@${redisConf.host}:${redisConf.port}/${redisConf.db}`
        });
        redisStack.client.on('error', (err) => console.log('Redis Client Error', err));
        await redisStack.client.connect();
        await RedisStack.test()
    }

    static async test() {
        let testKey = "hello";
        await redisStack.client.set(testKey, 'Scan Redis Stack', {EX: 1})
        const v = await redisStack.client.get(testKey)
        console.log(`redis test immediately: ${testKey} = [${v}]`)

        await sleep(2000);
        const v2 = await redisStack.client.get(testKey)
        console.log(`redis test after 2 seconds: ${testKey} = [${v2}]`)
    }

    static async close() {
        await redisWrap.client.quit();
    }

    // ---------------------------- basic method -----------------------------
    /*
    options:
    {
        EX: 1,
        NX: true,
        GET: true
    }
    */
    static async set(key: string, value: string, options) {
        return redisStack.client.set(key, value, options)
    }

    static async get(key: string) {
        return redisStack.client.get(key)
    }

    static async del(key:string) {
        return redisStack.client.del(key)
    }

    static async hSet(hash: string, field: string, value:any) {
        return redisStack.client.sendCommand(['hset', hash, field, value.toString()])
    }

    static async hGet(hash: string, field: string, defaultV:string) : Promise<string>{
        return redisStack.client.sendCommand(['hget', hash, field]).then(res=>{
            if (res === undefined || res === null) {
                res = defaultV
            }
            return res
        })
    }

    static async hGetAll(hash: string) {
        return redisStack.client.sendCommand(['HGETALL', hash])
    }

    /*
    memberArray:
    ['1','2']
    or single member:
    '1'
    */
    static async sAdd(key:string, member) {
        return redisStack.client.sAdd(key, member)
    }

    static async sCard(key:string) {
        return redisStack.client.sCard(key)
    }

    /*
    memberArray:
    [{
        value: '1',
        score: 1
    }]
    or single member:
    {
        value: '1',
        score: 1
    }
    */
    static async zAdd(key:string, member) {
        return redisStack.client.zAdd(key, member)
    }

    static async zCard(key:string) {
        return redisStack.client.zCard(key)
    }

    /*
    memberArray:
    ['1', '2']
    or single member:
    '1'
    */
    static async zRem(key:string, member) {
        return redisStack.client.zRem(key, member)
    }

    static async zRevRangeByScore(key:string, max, min, offset, count) {
        return redisStack.client.sendCommand(['ZREVRANGEBYSCORE', key, `${max}`, `${min}`, 'WITHSCORES', 'LIMIT', `${offset}`, `${count}`])
    }

    static async xDel(data:RedisStreamMessage[]) {
        return Promise.all(data.map(msg=>{
            return redisStack.client.sendCommand(['xdel', msg.stream, msg.messageId])
        }))
    }

    static async xLen(stream: string) {
        return redisStack.client.sendCommand(['xlen', stream])
    }

    // ---------------------------- stream method -----------------------------
    static tick = 0

    static async sendStreamMessage(msg:Object, q:string) {
        let str = JSON.stringify(msg);
        return redisStack.client.sendCommand(['XADD', q, '*', 'v1', str])
    }

    static async readStreamMessage(q:string, preIdExclusive = 0) {
        // `xread block 0` will block the client, sending message is blocked too.
        // So, only block for 10ms. // 'count', 1, performance issues.
        return redisStack.client.sendCommand(['XREAD', 'BLOCK', '10', 'COUNT', '300', 'STREAMS', q, `${preIdExclusive}`])
    }

    // XADD testListenQ * message apple
    // XADD TRANSFER_ADDRESS_Q * v1 [1]
    // XADD ERC20_TRANSFER_Q * v1 []
    static async listenStreamMessage(q:string,cb:(res:RedisStreamMessage[])=>Promise<any>, posFrom = 0) {
        // console.log(`listen on queue ${q}, tick ${RedisWrap.tick}`)
        RedisStack.readStreamMessage(q, posFrom).then(res=>{
            RedisStack.tick ++
            return new Promise(async r=>{
                if (res) {
                    // res could contains result of multiple stream
                    for (const data of res) {
                        // data contains result of each stream, include q name and array of biz data
                        const parseArr = RedisStack.convertMessage(data)
                        // callee handles message one by one;
                        for (let redisStreamMessage of parseArr) {
                            await cb([redisStreamMessage])
                        }
                    }
                    // return cb(RedisWrap.convertMessage(res))
                } else {
                    // console.log(`got nothing this round.`)
                }
                r(0)
            })
        }).then(()=>{
            setTimeout(()=>{
                RedisStack.listenStreamMessage(q, cb, posFrom)
            }, 0)
        }).catch(err=>{
            // stop listen
            console.log(`listenStreamMessage fail, queue [${q}]`, err)
        })
    }

    static convertMessage(stream:any) : RedisStreamMessage[] {
        const ret:RedisStreamMessage[] = []
        const streamName = stream[0]
        const msgArr:[] = stream[1]
        msgArr.forEach(msg=>{
            let json = {}
            try {
                json = JSON.parse(msg[1][1]);
            } catch (e) {
                json['__error_parse_json'] = e.toString()
            }

            ret.push({
                stream: streamName,
                messageId: msg[0],
                payload: msg[1],
                version: msg[1][0],
                message: json,
            })
        })
        return ret
    }

    static async testListenStream() {
        RedisStack.listenStreamMessage('testListenQ', (res)=>{
            console.log(`listen stream message got `, res)
            return RedisStack.xDel(res)
        }).then()
        await sleep(1000)
        RedisStack.sendStreamMessage({'test':'你好'}, 'testListenQ').then()
    }

    // -------------------------- instance field -----------------------------
    private client;
}

const redisStack = new RedisStack();

export class RedisStreamMessage {
    stream:string
    messageId:string
    payload:string
    version:string
    message:object
}
