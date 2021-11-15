import {
    RedisWrap,
    RedisStreamMessage,
    TPS_TRANSFER_Q, xLen,
} from "./RedisWrap";
import {KEY_TPS_TRANSFER, KV} from "../model/KV";
const lodash = require('lodash');

export class TransferTpsService {
    private app: any;
    private TRANSFER_COUNTER: any = {};
    private STAT_EPOCH_LENGTH = 60;

    constructor(app: any) {
        this.app = app;
    }

    public async schedule() {
        await this.listen();

        const that = this;
        async function repeat() {
            await that.setTps().catch(err=>{
                console.log(`transfer_tps_stat fail: `, err);
            });
            setTimeout(repeat, 1000);
        }
        repeat().then();
        console.log(`schedule transfer_tps_stat service in 1s interval`);
    }

    public async getTps(){
        const config = await KV.findOne({where: {key: KEY_TPS_TRANSFER}})
        return JSON.parse(config?.value || '{}');
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

    private async listen() {
        return RedisWrap.listenStreamMessage(TPS_TRANSFER_Q,
            async (data)=> { await this.statisticTransfer(data);});
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
                this.checkLength();
                const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false);
                const createdTime = new Date(Number(pivotBlock.timestamp) * 1000);
                message['createdTime'] = createdTime;
                this.TRANSFER_COUNTER[epochNumber] = message;
            }
            if(action === 'pop'){
                delete this.TRANSFER_COUNTER[epochNumber];
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
}
