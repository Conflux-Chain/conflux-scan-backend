import {
    RedisWrap,
    RedisStreamMessage,
    TPS_TRANSFER_Q, xLen, GAS_USED_PER_SECOND_Q,
} from "./RedisWrap";
import {
    KEY_GAS_USED_PER_SECOND, KEY_GAS_USED_PER_SECOND_NOTIFY,
    KEY_TPS_TRANSFER,
    KEY_TPS_TRANSFER_NOTIFY,
    KV
} from "../model/KV";
const lodash = require('lodash');

export class TransferTpsService {
    public static TPS_TRANSFER_NOTIFY: Boolean = false;

    private app: any;
    private TRANSFER_COUNTER: any = {};
    private GAS_USED_COUNTER: any = {};
    private STAT_EPOCH_LENGTH = 60;

    constructor(app: any) {
        this.app = app;
    }

    public async scheduleRefreshConfig(delay = 1000) {
        async function repeat() {
            await TransferTpsService.refreshConfig().catch(err=>{
                console.log(`tps_transfer_refresh_conf fail: `, err);
            });
            setTimeout(repeat, delay);
        }
        repeat().then();
        console.log(`schedule tps_transfer_refresh_conf service in 1s interval`);
    }

    public async schedule() {
        await this.listen();
        await this.listenGasUsed();

        const that = this;
        async function repeat() {
            await that.setTps().catch(err=>{
                console.log(`transfer_tps_stat fail: `, err);
            });
            await that.setGasUsedPerSecond().catch(err=>{
                console.log(`gas_used_per_second_stat fail: `, err);
            });
            setTimeout(repeat, 1000);
        }
        repeat().then();
        console.log(`schedule transfer_tps_stat service in 1s interval`);
    }

    private static async refreshConfig(){
        const notify = await KV.getSwitch(KEY_TPS_TRANSFER_NOTIFY);
        TransferTpsService.TPS_TRANSFER_NOTIFY = notify !== null ? notify: TransferTpsService.TPS_TRANSFER_NOTIFY;
    }

    public async getTps(){
        const config = await KV.findOne({where: {key: KEY_TPS_TRANSFER}})
        return config?.value ? JSON.parse(config?.value) : {tps: 0};
    }

    public async getGasUsedPerSecond(){
        const config = await KV.findOne({where: {key: KEY_GAS_USED_PER_SECOND}})
        return config?.value ? JSON.parse(config?.value) : {tps: 0};
    }

    private async setTps(){
        let statArray: any[] = Object.values(this.TRANSFER_COUNTER);
        statArray = lodash.orderBy(statArray, 'epochNumber', 'desc');

        let tpsInfo;
        const len = statArray.length;
        if( len === 0 ){
            tpsInfo = {
                tps: 0,
                maxEpoch: null,
                minEpoch: null,
                maxTime: null,
                minTime: null
            };
        } else if( len === 1 ){
            const statInfo = statArray[0];
            const tps = statInfo.erc20Cntr + statInfo.erc721Cntr + statInfo.erc1155Cntr;
            tpsInfo = {
                tps ,
                maxEpoch: statInfo.epochNumber,
                minEpoch: statInfo.epochNumber,
                maxTime: statInfo.createdTime,
                minTime: statInfo.createdTime
            };
        } else {
            const latest: any = statArray[0];
            const oldest: any = statArray[statArray.length - 1];
            const timeInterval = (latest.createdTime.getTime() - oldest.createdTime.getTime())/1000;
            let tranferTotal = 0;
            statArray.forEach(statInfo => {
                tranferTotal = tranferTotal + statInfo.erc20Cntr + statInfo.erc721Cntr + statInfo.erc1155Cntr;
            });
            const tps = tranferTotal / timeInterval;
            tpsInfo = {
                tps ,
                maxEpoch: latest.epochNumber,
                minEpoch: oldest.epochNumber,
                maxTime: latest.createdTime,
                minTime: oldest.createdTime
            };
        }

        const tpsJson = JSON.stringify(tpsInfo);
        await KV.upsert({value: tpsJson, key: KEY_TPS_TRANSFER});
    }

    private async setGasUsedPerSecond(){
        let statArray: any[] = Object.values(this.GAS_USED_COUNTER);
        statArray = lodash.orderBy(statArray, 'epochNumber', 'desc');

        let gupsInfo;
        const len = statArray.length;
        if( len === 0 ){
            gupsInfo = {
                gasUsedPerSecond: 0,
                maxEpoch: null,
                minEpoch: null,
                maxTime: null,
                minTime: null
            };
        } else if( len === 1 ){
            const statInfo = statArray[0];
            const gasUsedPerSecond = statInfo.statInfo.gasLimit;
            gupsInfo = {
                gasUsedPerSecond ,
                maxEpoch: statInfo.epochNumber,
                minEpoch: statInfo.epochNumber,
                maxTime: statInfo.createdTime,
                minTime: statInfo.createdTime
            };
        } else {
            const latest: any = statArray[0];
            const oldest: any = statArray[statArray.length - 1];
            const timeInterval = (latest.createdTime.getTime() - oldest.createdTime.getTime())/1000;
            let gasLimitTotal = BigInt(0);
            statArray.forEach(statInfo => {
                gasLimitTotal = gasLimitTotal + BigInt(statInfo.statInfo.gasLimit);
            });
            const gasUsedPerSecond = timeInterval === 0 ? BigInt(0) : gasLimitTotal / BigInt(timeInterval);
            gupsInfo = {
                gasUsedPerSecond ,
                maxEpoch: latest.epochNumber,
                minEpoch: oldest.epochNumber,
                maxTime: latest.createdTime,
                minTime: oldest.createdTime
            };
        }

        const gupsJson = JSON.stringify(gupsInfo);
        // console.log(`setStatGasUsedPerSecond ${JSON.stringify(gupsJson)}`)
        await KV.upsert({value: gupsJson, key: KEY_GAS_USED_PER_SECOND});
    }

    private async listen() {
        return RedisWrap.listenStreamMessage(TPS_TRANSFER_Q,
            async (data)=> { await this.statisticTransfer(data);});
    }

    private async listenGasUsed() {
        return RedisWrap.listenStreamMessage(GAS_USED_PER_SECOND_Q,
            async (data)=> { await this.statisticGasUsed(data);});
    }

    /* message format:
    * {
    *   epochNumber: 8888,
    *   epochTimestamp: "2023-12-15T10:27:15.000Z"
    *   action: push/pop,
    *   statInfo: {gasLimit: "90819949"}},
    * }
    */
    private async statisticTransfer(data:RedisStreamMessage[]) {
        const {
            app: { cfx },
        } = this;

        for (const item of data) {
            const {message} = item;
            const epochNumber = message['epochNumber'];
            const action = message['action'];
            if(action === 'push'){
                this.checkLength();
                const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false).catch(() => undefined);
                if(pivotBlock === undefined) continue;
                message['createdTime'] = new Date(Number(pivotBlock.timestamp) * 1000);
                this.TRANSFER_COUNTER[epochNumber] = message;
            }
            if(action === 'pop'){
                delete this.TRANSFER_COUNTER[epochNumber];
            }
        }
        await RedisWrap.xDel(data);
    }

    /* message format:
    * {
    *   epochNumber: 8888,
    *   action: push/pop,
    *   erc20Cntr: 8888,
    *   erc712Cntr: 8888,
    *   erc1155Cntr: 8888,
    *   createdTime: 111111,
    * }
    * */
    private async statisticGasUsed(data:RedisStreamMessage[]) {
        const {
            app: { cfx },
        } = this;

        for (const item of data) {
            const {message} = item;
            const epochNumber = message['epochNumber'];
            const action = message['action'];
            if(action === 'push'){
                this.checkLengthGasUsed();
                const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false).catch(() => undefined);
                if(pivotBlock === undefined) continue;
                message['createdTime'] = new Date(Number(pivotBlock.timestamp) * 1000);
                this.GAS_USED_COUNTER[epochNumber] = message;
            }
            if(action === 'pop'){
                delete this.GAS_USED_COUNTER[epochNumber];
            }
        }
        await RedisWrap.xDel(data);
    }

    private checkLength(){
        let keys = Object.keys(this.TRANSFER_COUNTER);
        if(keys.length < this.STAT_EPOCH_LENGTH) {
            return;
        }

        do{
            const min = lodash.min(keys);
            delete this.TRANSFER_COUNTER[min];
            keys = Object.keys(this.TRANSFER_COUNTER);
        } while (keys.length >= this.STAT_EPOCH_LENGTH);
    }

    private checkLengthGasUsed(){
        let keys = Object.keys(this.GAS_USED_COUNTER);
        if(keys.length < this.STAT_EPOCH_LENGTH) {
            return;
        }

        do{
            const min = lodash.min(keys);
            delete this.GAS_USED_COUNTER[min];
            keys = Object.keys(this.GAS_USED_COUNTER);
        } while (keys.length >= this.STAT_EPOCH_LENGTH);
    }
}
