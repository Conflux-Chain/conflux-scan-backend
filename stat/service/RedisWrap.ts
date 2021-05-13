import {RedisClient} from "redis";
import {RedisConf} from "../config/StatConfig";
const redis = require('redis');
const { promisify } = require('util');

export class RedisWrap{
    getAsync:Function
    setAsync:Function
    selectAsync:Function
    info:Function
    client:RedisClient
    static init(client:RedisClient) {
        redisWrap.client = client
        redisWrap.setAsync = promisify(client.set).bind(client);
        redisWrap.getAsync = promisify(client.get).bind(client);
        redisWrap.selectAsync = promisify(client.select).bind(client);
        redisWrap.info = promisify(client.info).bind(client);
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

    static async connect(redisConf:RedisConf) {
        const client = redis.createClient({
            host: redisConf.host,
            port: redisConf.port,
            password: redisConf.pwd,
        });
        RedisWrap.init(client)
        client.on('error', err => {
            console.log(`${new Date().toISOString()} Redis Error: ${err}`);
        });
        await redisWrap.selectAsync(redisConf.db || 0).then(res=>{
            console.log(`redis database number is ${redisConf.db} ${res}`)
        })
        await RedisWrap.test()
    }
}
export const redisWrap = new RedisWrap()