import {RedisWrap, PRUNE_Q, RedisStreamMessage} from "../RedisWrap";
import {PruneType} from "../../model/PruneInfo";
import {PruneBlock} from "./PruneBlock";
import {PruneTransaction} from "./PruneTransaction";
import {PruneTransfer} from "./PruneTransfer";
import {
    KEY_PRUNE_LOOP,
    KEY_PRUNE_DEL_ROWS_PER_LOOP,
    KEY_PRUNE_SLEEP_MS_PER_LOOP,
    KV
} from "../../model/KV";
import {PruneBase} from "./PruneBase";

export class PruneHandler {
    private app: any;
    private pruneBlock: PruneBlock;
    private pruneTransaction: PruneTransaction;
    private pruneTransfer: PruneTransfer;
    private CACHE_POOL = {};
    private CACHE_MARKER = {};
    private CACHE_COUNTER = {};
    private LEN_QUEUE_BIZ = 10_000;

    constructor(app: any) {
        this.app = app;
        this.pruneBlock = new PruneBlock(app);
        this.pruneTransaction = new PruneTransaction(app);
        this.pruneTransfer = new PruneTransfer(app);
        this.init();
    }

    public async scheduleRefreshConfig(delay = 1000) {
        async function repeat() {
            await PruneHandler.refreshConfig().catch(err=>{
                console.log(`prune_refresh_conf fail: `, err);
            });
            setTimeout(repeat, delay);
        }
        repeat().then();
        console.log(`schedule prune_refresh_conf service in 1s interval`);
    }

    public async schedule(delay = 10) {
        await this.listen();

        const that = this;
        async function repeat() {
            await that.handle().catch(err=>{
                console.log(`prune_task error:`, err)
            })
            setTimeout(repeat, delay)
        }

        repeat().then()
        console.log(`prune_task started with delay ${delay}`)
    }

    private init(){
        Object.values(PruneType).forEach(type => {
            this.CACHE_POOL[type] = [];
            this.CACHE_MARKER[type] = new Set();
            this.CACHE_COUNTER[type] = {};
        });
    }

    private static async refreshConfig(){
        const [loop, delRowsPerLoop, sleepMsPerLoop] = await Promise.all([
            KV.getNumber(KEY_PRUNE_LOOP),
            KV.getNumber(KEY_PRUNE_DEL_ROWS_PER_LOOP),
            KV.getNumber(KEY_PRUNE_SLEEP_MS_PER_LOOP),
        ]);

        PruneBase.PRUNE_LOOP = loop !== null ? loop : PruneBase.PRUNE_LOOP;
        PruneBase.DEL_ROWS_PER_LOOP = delRowsPerLoop !== null ?
            (delRowsPerLoop > PruneBase.DEL_ROWS_MAX_PER_LOOP ? PruneBase.DEL_ROWS_MAX_PER_LOOP : delRowsPerLoop) :
            PruneBase.DEL_ROWS_PER_LOOP;
        PruneBase.SLEEP_MS_PER_LOOP = sleepMsPerLoop !== null ? sleepMsPerLoop : PruneBase.SLEEP_MS_PER_LOOP;
    }

    private async listen() {
        return RedisWrap.listenStreamMessage(PRUNE_Q, (data) => this.enqueue(data));
    }

    private async enqueue(data:RedisStreamMessage[]) {
        for (const item of data) {
            const {message} = item;
            for (const type of Object.keys(message)) {
                const pruneInfoArray = message[type];

                for (const pruneInfo of pruneInfoArray) {
                    const addressId = pruneInfo?.addressId;
                    if (addressId === undefined) {
                        continue;
                    }

                    const counterMap = this.CACHE_COUNTER[type];
                    if(counterMap[addressId] === undefined){
                        counterMap[addressId] = 1;
                    } else{
                        counterMap[addressId] ++;
                    }
                    if(counterMap[addressId] % 1 !== 0){
                        continue;
                    }
                    delete counterMap[addressId];

                    const marker = this.CACHE_MARKER[type];
                    if(marker.has(addressId)){
                        continue;
                    }

                    let needPrune = false;
                    const task = {type, pruneInfo};
                    if(type === PruneType.BLOCK || type === PruneType.MINER_BLOCK){
                        needPrune = await this.pruneBlock.needPrune(task);
                    } else if(type === PruneType.TX || type === PruneType.ADDR_TX){
                        needPrune = await this.pruneTransaction.needPrune(task);
                    } else {
                        needPrune= await this.pruneTransfer.needPrune(task);
                    }
                    if(!needPrune){
                        continue;
                    }

                    const queue = this.CACHE_POOL[type];
                    if(queue.length > this.LEN_QUEUE_BIZ){
                        continue;
                    }

                    queue.push(pruneInfo);
                    marker.add(addressId);
                    console.log(`prune_enqueue[type=${type}][addressId=${addressId}],task:${JSON.stringify(task)},qLen:${queue.length}`);
                }
            }
        }
        return RedisWrap.xDel(data);
    }

    private async handle(){
        for (const type of Object.keys(this.CACHE_POOL)) {
            const queue = this.CACHE_POOL[type];
            const pruneInfo = queue.shift();
            const addressId = pruneInfo?.addressId;
            if (addressId === undefined) {
                continue;
            }
            this.CACHE_MARKER[type].delete(addressId);


            const task = {type, pruneInfo};
            console.log(`prune_handle[type=${type}][addressId=${addressId}],task:${JSON.stringify(task)},qLen:${queue.length}`);
            if(type === PruneType.BLOCK || type === PruneType.MINER_BLOCK){
                await this.pruneBlock.prune(task);
            } else if(type === PruneType.TX || type === PruneType.ADDR_TX){
                await this.pruneTransaction.prune(task);
            } else {
                await this.pruneTransfer.prune(task);
            }
        }
    }

    public getDevMetrics(){
        return {
            cache: {
                pool: this.CACHE_POOL,
                marker: this.CACHE_MARKER,
            },
            prune: {
                pruneLoop: PruneBase.PRUNE_LOOP,
                delRowsPerLoop: PruneBase.DEL_ROWS_PER_LOOP,
                sleepMsPerLoop: PruneBase.SLEEP_MS_PER_LOOP,
            },
            metrics: PruneBase.metrics,
        };
    }
}
