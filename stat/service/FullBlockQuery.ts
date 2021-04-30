// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {FullBlock} from "../model/FullBlock";
import {Hex40Map} from "../model/HexMap";
import {StatApp} from "../StatApp";

export class FullBlockQuery {
    public async listBlock({epochNumber, blockHash, beginTime, endTime, miner, skip = 0, limit = 10}) {
        const options: any = {};
        // fields
        options.attributes = ['epoch',
            'position',
            'txCount',
            'executedTxnCount',
            'hash',
            'minerId',
            'avgGasPrice',
            'gasUsed',
            'gasLimit',
            'totalReward',
            'createdAt',
        ];

        // parse para
        let minerId;
        if(miner){
            const hex40 = await Hex40Map.findOne({where: {hex: miner.substr(2)}})
            minerId = hex40?.id
        }

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

        // page
        options.offset = skip;
        options.limit = limit;
        const page = await FullBlock.findAndCountAll(options);
        if(page && page.rows){
            const minerIdArray = [];
            page.rows.forEach( row => {
                minerIdArray.push(row.minerId);
            });
            // miner address
            const hex40Array = await Hex40Map.findAll({
                where: {
                    id: { [Op.in]: minerIdArray}
                },
            })
            const hex40IdMap = new Map<number, string>()
            hex40Array.forEach(hex40=>{
                hex40IdMap.set(hex40.id, hex40.hex)
            })
            page.rows.forEach(row=>{
                const base32 = format.address(`0x${hex40IdMap.get(row.minerId)}`, StatApp.networkId);
                row['miner'] = base32;
            })
        }
        return page;
    }
}


