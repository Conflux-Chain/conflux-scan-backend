// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {FullBlock} from "../model/FullBlock";
import {Hex40Map} from "../model/HexMap";
import {StatApp} from "../StatApp";

export class FullBlockQuery {
    protected app;

    protected constructor(app) {
        this.app = app;
    }

    public async listBlock({epochNumber, blockHash, beginTime, endTime, miner, skip = 0, limit = 10}) {
        // parse para
        let minerId;
        if(miner){
            const hex40 = await Hex40Map.findOne({where: {hex: miner.substr(2)}})
            minerId = hex40?.id
        }

        // fields
        const options: any = {};
        options.attributes = [
            ['epoch', 'epochNumber'],
            'hash',
            ['minerId', 'miner'],
            'gasLimit',
            'difficulty',
            ['createdAt', 'timestamp'],
            ['txCount', 'transactionCount'],
            ['executedTxnCount', 'executedTransactionCount'],
            'avgGasPrice',
            ['position', 'blockIndex'],
            ['pivot', 'pivotHash'],
            'gasUsed',
            'totalReward',
        ];

        // conditions
        const conditionArray = [];
        if(epochNumber){
            conditionArray.push({epoch: epochNumber});
        }
        if(blockHash){
            conditionArray.push({hash: blockHash});
        }
        if(beginTime && endTime){
            conditionArray.push({createdAt: {
                    [Op.gte]:beginTime.getTime() / 1000
                }});
            conditionArray.push({createdAt: {
                    [Op.lt]:endTime.getTime() / 1000
                }});
        }
        if(minerId){
            conditionArray.push({minerId});
        }
        let query: any = {};
        if(conditionArray.length >= 2){
            query[Op.and] = conditionArray;
        }
        if(conditionArray.length === 1){
            query = conditionArray[0];
        }
        if(Object.keys(query).length !== 0){
            options.where = query;
        }

        // order by
        const order = [];
        const orderItem = ['createdAt', 'DESC'];
        order.push(orderItem);
        options.order = order;

        // page
        options.offset = skip;
        options.limit = limit;
        const page = await FullBlock.findAndCountAll(options);

        // process para
        const list = [];
        if(page && page.rows){
            const hex40IdSet = new Set<number>();
            page.rows.forEach( item => {
                const row = item.toJSON();
                hex40IdSet.add(row['miner']);
                list.push(row);
            });
            const hex40Array = await Hex40Map.findAll({
                where: {
                    id: { [Op.in]: Array.from(hex40IdSet)}
                },
            })
            const hex40Map = new Map<number, string>()
            hex40Array.forEach(hex40=>{
                hex40Map.set(hex40.id, hex40.hex)
            })
            list.forEach(row=>{
                const minerId = row['miner'];
                if(minerId && hex40Map.get(minerId)){
                    const base32 = format.address(`0x${hex40Map.get(minerId)}`, StatApp.networkId);
                    row['miner'] = base32;
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                const pivotHash = row['pivotHash'] ? row['hash'] : undefined;
                row['pivotHash'] = pivotHash;
            })
        }

        if(this.app && this.app?.logger){
            this.app.logger.info({src: 'fullblock.findAndCountAll------------', total: `${page?.count}`, list});
        }
        return {total: page?.count, list};
    }
}


