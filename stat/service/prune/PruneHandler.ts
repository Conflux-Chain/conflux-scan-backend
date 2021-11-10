import {RedisWrap, PRUNE_Q, RedisStreamMessage} from "../RedisWrap";
import {PruneType} from "../../model/PruneInfo";
import {PruneBlock} from "./PruneBlock";
import {PruneTransaction} from "./PruneTransaction";
import {PruneTransfer} from "./PruneTransfer";

export class PruneHandler {
    private app: any;
    private pruneBlock: PruneBlock;
    private pruneTransaction: PruneTransaction;
    private pruneTransfer: PruneTransfer;
    private CACHE_POOL = {};
    private CACHE_MARKER = {};
    private LEN_QUEUE_BIZ = 1000;

    constructor(app: any) {
        this.app = app;
        this.pruneBlock = new PruneBlock(app);
        this.pruneTransaction = new PruneTransaction(app);
        this.pruneTransfer = new PruneTransfer(app);
        this.init();
    }

    public async schedule(delay = 1_000 * 10) {
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
        });
    }

    private async listen() {
        return RedisWrap.listenStreamMessage(PRUNE_Q, (data) => this.enqueue(data));
    }

    private async enqueue(data:RedisStreamMessage[]) {
        for (const item of data) {
            const {message} = item;
            Object.keys(message).forEach(type => {
                const addressIdArray = message[type];

                addressIdArray.forEach(addressId => {
                    const marker = this.CACHE_MARKER[type];
                    if(marker.has(addressId)){
                        return;
                    }

                    const queue = this.CACHE_POOL[type];
                    if(queue.length > this.LEN_QUEUE_BIZ){
                        return;
                    }

                    queue.push(addressId);
                    marker.add(addressId);
                    // console.log(`prune_enqueue[type=${type}],addressId:${addressId},queueLen:${queue.length}`);
                });
            });
        }
        return RedisWrap.xDel(data);
    }

    private async handle(){
        for (const type of Object.keys(this.CACHE_POOL)) {
            const addressId = this.CACHE_POOL[type].pop();
            if (addressId === undefined) {
                continue;
            }
            this.CACHE_MARKER[type].delete(addressId);

            const keepRows = PruneHandler.getKeepRowsByType(type);
            const pruneParas = PruneHandler.getPruneParas({type, addressId});
            const task = {type, keepRows, pruneParas};

            if(type === PruneType.BLOCK || type === PruneType.MINER_BLOCK){
                await this.pruneBlock.prune(task);
            } else if(type === PruneType.TX || type === PruneType.ADDR_TX){
                await this.pruneTransaction.prune(task);
            } else {
                await this.pruneTransfer.prune(task);
            }
            // console.log(`prune_handle[type=${type}],task:${JSON.stringify(task)}`);
        }
    }

    private static getKeepRowsByType(type): number{
        let keepRows;
        switch (type) {
            case PruneType.BLOCK:
            case PruneType.TX:
            case PruneType.CFX_TRANSFER:
            case PruneType.ERC20_TRANSFER:
            case PruneType.ERC721_TRANSFER:
            case PruneType.ERC1155_TRANSFER:
                keepRows = 20_000;
                break;
            case PruneType.MINER_BLOCK:
            case PruneType.ADDR_TX:
            case PruneType.ADDR_CFX_TRANSFER:
            case PruneType.ADDR_ERC20_TRANSFER:
            case PruneType.ADDR_ERC721_TRANSFER:
            case PruneType.ADDR_ERC1155_TRANSFER:
                keepRows = 20_000;
                break;
            default:
                throw new Error(`unknown prune type:${type}`);
        }
        return keepRows;
    }

    private static getPruneParas({type, addressId}): any{
        const isTokenTransfer = type === PruneType.ERC20_TRANSFER
            || type === PruneType.ERC721_TRANSFER
            || type === PruneType.ERC1155_TRANSFER;
        const contractId = isTokenTransfer ? addressId : undefined;
        return {addressId, contractId};
    }
}
