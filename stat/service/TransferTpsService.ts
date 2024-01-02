import {
    RedisWrap,
    RedisStreamMessage,
    TPS_TRANSFER_Q, xLen, GAS_USED_PER_SECOND_Q, GAS_PRICE_TRACKER_Q,
} from "./RedisWrap";
import {
    KEY_GAS_PRICE_TRACKER,
    KEY_GAS_USED_PER_SECOND,
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
    private GAS_PRICE_COUNTER: any = {};
    private STAT_EPOCH_SPAN = 60;

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
        await this.listenGasPrice();

        const that = this;
        async function repeat() {
            await that.setTps().catch(err=>{
                console.log(`transfer_tps_stat fail: `, err);
            });
            await that.setGasUsedPerSecond().catch(err=>{
                console.log(`gas_used_per_second_stat fail: `, err);
            });
            await that.setGasPrice().catch(err=>{
                console.log(`gas_price_stat fail: `, err);
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

    public async getGasPrice(){
        const config = await KV.findOne({where: {key: KEY_GAS_PRICE_TRACKER}})
        return config?.value ? JSON.parse(config?.value) :{
            gasPriceInfo: {min: 0, tp50: 0, max: 0},
            gasPriceMarket: {min: 0, tp25: 0, tp50: 0, tp75: 0, max: 0},
        }
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

    private async setGasPrice(){
        let statArray: any[] = Object.values(this.GAS_PRICE_COUNTER);
        statArray = lodash.orderBy(statArray, 'epochNumber', 'desc');

        let gasPriceInfo;
        const len = statArray.length;
        if( len === 0 ){
            gasPriceInfo = {
                gasPriceInfo: {min: 0, tp50: 0, max: 0},
                gasPriceMarket: {min: 0, tp25: 0, tp50: 0, tp75: 0, max: 0},
                maxEpoch: null,
                minEpoch: null,
                maxTime: null,
                minTime: null
            };
        } else if( len === 1 ){
            const stat = statArray[0];
            const gasPriceArray = stat.statInfo.gasPrice;
            const gasPriceTP = this.getPriceInTopPercentile(gasPriceArray);
            gasPriceInfo = {
                gasPriceInfo: {...lodash.pick(gasPriceTP, ['min', 'tp50', 'max'])},
                gasPriceMarket: {...gasPriceTP},
                maxEpoch: stat.epochNumber,
                minEpoch: stat.epochNumber,
                maxTime: stat.createdTime,
                minTime: stat.createdTime,
                blockHeight: stat.blockHeight,
            };
        } else {
            const latest: any = statArray[0];
            const oldest: any = statArray[statArray.length - 1];
            const gasPriceSet = new Set();
            statArray.forEach(stat => stat.statInfo.gasPrice.forEach(gasPrice => gasPriceSet.add(gasPrice)));
            gasPriceInfo = {
                gasPriceInfo: {... lodash.pick(this.getPriceInTopPercentile(latest.statInfo.gasPrice), ['min', 'tp50', 'max'])},
                gasPriceMarket: {... this.getPriceInTopPercentile([...gasPriceSet])},
                maxEpoch: latest.epochNumber,
                minEpoch: oldest.epochNumber,
                maxTime: latest.createdTime,
                minTime: oldest.createdTime,
                blockHeight: latest.blockHeight,
            };
        }

        const gasPriceJson = JSON.stringify(gasPriceInfo);
        await KV.upsert({value: gasPriceJson, key: KEY_GAS_PRICE_TRACKER});
    }

    private async listen() {
        return RedisWrap.listenStreamMessage(TPS_TRANSFER_Q,
            async (data)=> { await this.statisticTransfer(data);});
    }

    private async listenGasUsed() {
        return RedisWrap.listenStreamMessage(GAS_USED_PER_SECOND_Q,
            async (data)=> { await this.statisticGasUsed(data);});
    }

    private async listenGasPrice() {
        return RedisWrap.listenStreamMessage(GAS_PRICE_TRACKER_Q,
            async (data)=> { await this.statisticGasPrice(data);});
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
    private async statisticTransfer(data:RedisStreamMessage[]) {
        const {
            app: { cfx },
        } = this;

        for (const item of data) {
            const {message} = item;
            const epochNumber = message['epochNumber'];
            const action = message['action'];
            if(action === 'push'){
                this.checkLength(this.TRANSFER_COUNTER, this.STAT_EPOCH_SPAN);
                const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false).catch(() => undefined);
                if(pivotBlock === undefined || pivotBlock === null) continue;
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
    *   epochTimestamp: "2023-12-15T10:27:15.000Z"
    *   action: push/pop,
    *   statInfo: {gasLimit: "90819949"}},
    * }
    */
    private async statisticGasUsed(data:RedisStreamMessage[]) {
        const {
            app: { cfx },
        } = this;

        for (const item of data) {
            const {message} = item;
            const epochNumber = message['epochNumber'];
            const action = message['action'];
            if(action === 'push'){
                this.checkLength(this.GAS_USED_COUNTER, this.STAT_EPOCH_SPAN);
                const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false).catch(() => undefined);
                if(pivotBlock === undefined || pivotBlock === null) continue;
                message['createdTime'] = new Date(Number(pivotBlock.timestamp) * 1000);
                this.GAS_USED_COUNTER[epochNumber] = message;
            }
            if(action === 'pop'){
                delete this.GAS_USED_COUNTER[epochNumber];
            }
        }
        await RedisWrap.xDel(data);
    }

    /* message format:
    * {
    *   epochNumber: 8888,
    *   epochTimestamp: "2023-12-15T10:27:15.000Z"
    *   action: push/pop,
    *   statInfo: {gasLimit: "90819949"}},
    * }
    */
    private async statisticGasPrice(data:RedisStreamMessage[]) {
        const {
            app: { cfx },
        } = this;

        for (const item of data) {
            const {message} = item;
            const epochNumber = message['epochNumber'];
            const action = message['action'];
            if(action === 'push'){
                this.checkLength(this.GAS_PRICE_COUNTER, this.STAT_EPOCH_SPAN);
                const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false).catch(() => undefined);
                if(pivotBlock === undefined || pivotBlock === null) continue;
                message['blockHeight'] = pivotBlock.height
                message['createdTime'] = new Date(Number(pivotBlock.timestamp) * 1000);
                this.GAS_PRICE_COUNTER[epochNumber] = message;
            }
            if(action === 'pop'){
                delete this.GAS_PRICE_COUNTER[epochNumber];
            }
        }
        await RedisWrap.xDel(data);
    }

    private checkLength(statObj, epochSpan){
        let keys = Object.keys(statObj);
        if(keys.length < epochSpan) {
            return;
        }

        do{
            const min = lodash.min(keys);
            delete statObj[min];
            keys = Object.keys(statObj);
        } while (keys.length >= epochSpan);
    }

    private getPriceInTopPercentile(gasPriceArray) {
        const gasPriceNumberArray = gasPriceArray.map(gasPrice => Number(gasPrice))
        const orderedGasPriceArray = gasPriceNumberArray.sort((a, b) => a - b)
        const p = orderedGasPriceArray[0]
        if(gasPriceArray.length === 1) {
            return { min: p, tp25: p, tp50: p, tp75: p, max: p }
        }

        if(p === 0) {
            orderedGasPriceArray.shift()
        }

        const size = gasPriceNumberArray.length
        const tp25Index = Math.ceil(size * 0.25) -1
        const tp50Index = Math.ceil(size * 0.5) -1
        const tp75Index = Math.ceil(size * 0.75) -1

        const min = orderedGasPriceArray[0]
        const tp25 = orderedGasPriceArray[tp25Index]
        const tp50 = orderedGasPriceArray[tp50Index]
        const tp75 = orderedGasPriceArray[tp75Index]
        const max = orderedGasPriceArray[size - 1]

        return {min, tp25, tp50, tp75, max}
    }
}
