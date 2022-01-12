import {RedisClient} from "redis";
import {RedisConf} from "../config/StatConfig";
import {sleep} from "./tool/ProcessTool";
const redis = require('redis');
const { promisify } = require('util');
export const CHANNEL_TEST = 'test'
export const TRANSFER_ADDRESS_Q = 'TRANSFER_ADDRESS_Q' // only contains address id.
export const CFX_TRANSFER_ADDRESS_Q = 'CFX_TRANSFER_ADDRESS_Q' // only contains address id.
// export const TRANSFER_ADDRESS_WITH_CONTRACT_Q = 'TRANSFER_ADDRESS_WITH_CONTRACT_Q' // contains address id and contract id.
export const ERC20_TRANSFER_Q = 'ERC20_TRANSFER_Q'
export const ERC721_TRANSFER_Q = 'ERC721_TRANSFER_Q'
export const ERC777_TRANSFER_Q = 'ERC777_TRANSFER_Q'
export const ERC1155_TRANSFER_Q = 'ERC1155_TRANSFER_Q'
export const CFX_TRANSFER_Q = 'CFX_TRANSFER_Q'
export const POW_EPOCH_FOR_POS_Q = 'POW_EPOCH_FOR_POS_Q'
export const PRUNE_Q = 'PRUNE_Q';

export const TPS_TRANSFER_Q = 'TPS_TRANSFER_Q'

export const STREAM_STAT_TOKEN_TRANSFER_Q = 'STREAM_STAT_TOKEN_TRANSFER_Q';
export const STREAM_STAT_ADDR_TRANSACTION_Q = 'STREAM_STAT_ADDR_TRANSACTION_Q';
export const STREAM_STAT_ADDR_CFX_TRANSFER_Q = 'STREAM_STAT_ADDR_CFX_TRANSFER_Q';
export const STREAM_STAT_DAILY_CFX_TRANSFER_Q = 'STREAM_STAT_DAILY_CFX_TRANSFER_Q';
export const STREAM_STAT_DAILY_TOKEN_TRANSFER_Q = 'STREAM_STAT_DAILY_TOKEN_TRANSFER_Q';
export const STREAM_STAT_MINER_BLOCK_Q = 'STREAM_STAT_MINER_BLOCK_Q';

export const HASH_CUSTODIAN_TOKEN = 'CUSTODIAN_TOKEN'

export class RedisWrap{
    getAsync:Function
    setAsync:Function
    selectAsync:Function
    sendCommand:Function
    info:Function
    sadd:Function
    scard:Function
    del:Function
    zadd:Function
    zrange:Function
    zrem:Function
    zcard:Function
    zrevrangebyscore:Function
    ZRANGEBYSCORE:Function
    // hsetnx:Function
    client:RedisClient
    static init(client:RedisClient) {
        redisWrap.client = client
        redisWrap.setAsync = promisify(client.set).bind(client);
        redisWrap.getAsync = promisify(client.get).bind(client);
        redisWrap.selectAsync = promisify(client.select).bind(client);
        redisWrap.info = promisify(client.info).bind(client);
        // redisWrap.hsetnx = promisify(client.hsetnx).bind(client);
        redisWrap.sadd = promisify(client.sadd).bind(client);
        redisWrap.scard = promisify(client.scard).bind(client);
        redisWrap.del = promisify(client.del).bind(client);
        redisWrap.zadd = promisify(client.zadd).bind(client);
        redisWrap.zrange = promisify(client.zrange).bind(client);
        redisWrap.zrem = promisify(client.zrem).bind(client);
        redisWrap.zcard = promisify(client.zcard.bind(client));
        redisWrap.zrevrangebyscore = promisify(client.zrevrangebyscore.bind(client));
        redisWrap.ZRANGEBYSCORE = promisify(client.ZRANGEBYSCORE.bind(client));
        redisWrap.sendCommand = promisify(client.sendCommand).bind(client);
    }

    static async test() {
        // await redisWrap.info().then(res=>{
        //     console.log(`redis server info: ${res}`)
        // })
        let testKey = "hello";
        await redisWrap.setAsync(testKey, 'Scan Redis')
        return redisWrap.getAsync(testKey).then(res=>{
            console.log(`redis test : ${testKey} = [${res}]`)
        })
    }

    static async testSub (channel:string, cb: (channel: string, message: string) => void) {
        redisWrap.client.subscribe(channel)
        redisWrap.client.on('message', cb)
    }

    static async connect(redisConf:RedisConf) {
        console.log(`connect to redis: ${redisConf.host} ${redisConf.port} db ${redisConf.db}`)
        const client = redis.createClient({
            host: redisConf.host,
            port: redisConf.port,
            password: redisConf.pwd,
            db: redisConf.db,
        });
        //client.subscribe()
        RedisWrap.init(client)
        client.on('error', err => {
            console.log(`${new Date().toISOString()} Redis Error: ${err}`);
        });
        /*  It's in the option when creating client.
        await redisWrap.selectAsync(redisConf.db || 0).then(res=>{
            console.log(`redis database number is ${redisConf.db} ${res}`)
        }) */
        await RedisWrap.test()
    }
    static async sendStreamMessage(msg:Object, q:string) {
        let str = JSON.stringify(msg);
        return redisWrap.sendCommand('XADD', [q, '*', 'v1', str])
    }
    static async readStreamMessage(q:string, preIdExclusive = 0) {
        // `xread block 0` will block the client, sending message is blocked too.
        // So, only block for 10ms. // 'count', 1, performance issues.
        return redisWrap.sendCommand('XREAD', ['BLOCK', 10, 'STREAMS', q, preIdExclusive])
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
    static tick = 0
    // XADD testListenQ * message apple
    // XADD TRANSFER_ADDRESS_Q * v1 [1]
    // XADD ERC20_TRANSFER_Q * v1 []
    static async listenStreamMessage(q:string,cb:(res:RedisStreamMessage[])=>Promise<any>, posFrom = 0) {
        // console.log(`listen on queue ${q}, tick ${RedisWrap.tick}`)
        RedisWrap.readStreamMessage(q, posFrom).then(res=>{
            RedisWrap.tick ++
            return new Promise(async r=>{
                if (res) {
                    // res could contains result of multiple stream
                    for (const data of res) {
                        // data contains result of each stream, include q name and array of biz data
                        const parseArr = RedisWrap.convertMessage(data)
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
                RedisWrap.listenStreamMessage(q, cb, posFrom)
            }, 0)
        }).catch(err=>{
            // stop listen
            console.log(`listenStreamMessage fail, queue [${q}]`, err)
        })
    }

    static async hGetAll(hash: string) {
        return redisWrap.sendCommand('HGETALL', [hash])
    }
    static async hSet(hash: string, field: string, value:any) {
        return redisWrap.sendCommand('hset', [hash, field, value.toString()])
    }
    static async hGet(hash: string, field: string, defaultV:string) : Promise<string>{
        return redisWrap.sendCommand('hget', [hash, field]).then(res=>{
            if (res === undefined || res === null) {
                res = defaultV
            }
            return res
        })
    }
    static async saddm(key:any, members:any[]) {
        return redisWrap.sadd(key, members)
    }
    static async sadd(key:string, ...members) {
        return redisWrap.sadd(key, members)
    }
    static async zadd(key:string, score:any, member:any) {
        return redisWrap.zadd(key, score, member)
    }
    static async scard(key:string) {
        return redisWrap.scard(key)
    }
    static async del(key:string) {
        return redisWrap.del(key)
    }
    static async xDel(data:RedisStreamMessage[]) {
        return Promise.all(data.map(msg=>{
            return redisWrap.client.sendCommand('xdel', [msg.stream, msg.messageId])
        }))
    }
    static async testListenStream() {
        RedisWrap.listenStreamMessage('testListenQ', (res)=>{
            console.log(`listen stream message got `, res)
            return RedisWrap.xDel(res)
        }).then()
        await sleep(1000)
        RedisWrap.sendStreamMessage({'test':'你好'}, 'testListenQ').then()
    }
    // https://redis.io/topics/streams-intro
    // Pub/Sub messages are fire and forget and are never stored anyway,
    static async testStream() {
        const qName = 'testStreamQueue'
        const client = redisWrap.client
        const xgroup = await redisWrap.sendCommand('XGROUP', 'CREATE newstream mygroup $ MKSTREAM'.split(' ')).catch((err)=> {
            // @ts-ignore
            if (err.code === 'BUSYGROUP') {
                console.log(`BUSYGROUP: ${err.message}`)
            } else {
                return Promise.reject(err)
            }
        }).then(()=>{
            console.log(`xgroup ok.`)
            return redisWrap.sendCommand('XADD', 'mystream * sensor-id 1234 temperature 19.8'.split(' '))
        }).then(res=>{
            console.log(`xadd ok ${res}`)
            return redisWrap.sendCommand('XLEN', ['mystream'])
        }).then(res=>{
            console.log(`xlen ret ${res}`)
            return redisWrap.sendCommand('XREAD', 'COUNT 2000 STREAMS mystream 0'.split(' '))
        }).then(res=>{
            console.log(`xread got ${JSON.stringify(res)}`)
            let msgId = res[0][1][0][0];
            console.log(`prepare remove ${msgId}`)
            return redisWrap.sendCommand('XDEL', `mystream ${msgId}`.split(' '))
        }).then(res=>{
            console.log(`remove got : ${res}`)
            const posStart = '$' // preId or $
            console.log(`command is : `, 'XREAD', `BLOCK 0 STREAMS mystream ${posStart}`)
            /*
            // @ts-ignore
            client.xread('BLOCK', 0, 'STREAMS', 'mystream', '$', (err, str) => {
                if (err) return console.error('Error reading from stream:', err);

                str.forEach(message => {
                    console.log('got message!', message);
                });
            })*/
            // @ts-ignore
            // client.xread(`BLOCK 5000 STREAMS mystream ${posStart}`.split(' '), (err, reply)=>{
            //     console.log(`directly send_command got `, err, reply)
            // })
            return redisWrap.sendCommand('XREAD', `BLOCK 6000 STREAMS mystream ${posStart}`.split(' '))
        }).then(res=>{
            console.log(`xread block style, got ${res[0][1].length} : ${JSON.stringify(res)}`)
        }).then(res=>{
            return redisWrap.client.quit()
        }).then(res=>{
            console.log(`redis quit got ${res}`)
        }).then(res=>{
        }).catch(err=>{
            console.log(`redis stream err:`, err)
        })
    }
}
export class RedisStreamMessage {
    stream:string
    messageId:string
    payload:string
    version:string
    message:object
}
export const redisWrap = new RedisWrap()

export async function xLen(stream: string) {
    // @ts-ignore
    return redisWrap.sendCommand('xlen', [stream])
}
/*
apt install redis-tools
 */
