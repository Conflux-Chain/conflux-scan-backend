// @ts-ignore
import {format} from "js-conflux-sdk";
import {Hex40Map, Hex64Map, idHex40Map, idHex64Map, hex40IdMap, formatToHex} from "../model/HexMap";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {Op} from "sequelize";
import {FullTransaction} from "../model/FullBlock";
const lodash = require('lodash');

export class BlockTraceCreateQuery{
    protected app;

    constructor(app: any) {
        this.app = app;
    }

    async query(address: string) {
        const{ cfx, logger } = this.app;

        const hex40Bean = await Hex40Map.findOne({where: {hex: address.substr(2)}});
        if(!hex40Bean){
            // logger?.info({src: `trace_create`, 'result': `no contract ${address}`});
            return {msg: `get create trace, no contract ${address} found`};
        }

        const trace = await TraceCreateContract.findOne({where: {to: hex40Bean.id}});
        if(!trace){
            // logger?.info({src: `trace_create`, 'result': `no trace_create_contract for contract ${address}`});
            return {msg: `get create trace, no create trace found for contract ${address}`};
        }
        // use EOA from as contract creator, not the trace caller.
        let from = undefined
        let hash = '0x'+trace.txHash;
        const localTx = await FullTransaction.findOne({where:{hash: hash}});
        if (localTx) {
            const fromHex40Bean = await Hex40Map.findOne({where: {id: localTx.fromId}});
            from = fromHex40Bean ? `0x${fromHex40Bean.hex}` : undefined
        } else {
            const rpcTx = await cfx.getTransactionByHash(hash);
            if (rpcTx) {
                from = formatToHex(rpcTx.from)
            }
        }


        return {
            epochNumber: trace.epochNumber,
            transactionHash: `0x${trace.txHash}`,
            from,
            address,
        };
    }

    public async list({addressArray, from, minEpochNumber, maxEpochNumber, minTimestamp, maxTimestamp, skip = 0,
                          limit = 10, reverse = false}) {
        const{ logger } = this.app;
        // parse para
        let addressIdArray;
        if(addressArray){
            if (!lodash.isArray(addressArray)) {
                addressArray = [addressArray];
            }
            addressArray = addressArray.map(item => format.hexAddress(item).substr(2));
            const map = await hex40IdMap(addressArray);
            addressIdArray = [...map.values()];
        }
        if(addressArray !== undefined && addressIdArray === undefined){
            return {total: 0, list: []};
        }
        let fromId;
        if(from){
            const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(from).substr(2)}})
            fromId = hex40?.id
        }
        if(from !== undefined && fromId === undefined){
            return {total: 0, list: []};
        }
        // attributes
        const options: any = {offset: skip, limit, raw: true};
        options.attributes = [
            'epochNumber',
            ['txHash', 'transactionHash'],
            'from',
            ['to', 'address'],
        ];
        // where
        const conditionArray = [];
        if(addressArray){
            conditionArray.push({ to: { [Op.in]: addressIdArray } });
        }
        if(from){
            conditionArray.push({from: fromId});
        }
        if(minEpochNumber && maxEpochNumber) {
            conditionArray.push({ [Op.and]: [{epochNumber: { [Op.gte]: minEpochNumber}},
                    {epochNumber: { [Op.lt]: maxEpochNumber}}]});
        }
        if(minTimestamp && maxTimestamp) {
            conditionArray.push({ [Op.and]: [{blockTime: { [Op.gte]: minTimestamp}},
                    {blockTime: { [Op.lt]: maxTimestamp}}]});
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        if(reverse){
            options.order = [['blockTime', 'DESC']];
        }
        // query
        const page = await TraceCreateContract.findAndCountAll(options);
        const list = [];
        if(page?.rows){
            const hex40IdSet = new Set<number>();
            page.rows.forEach( row => {
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['address']);
                list.push(row);
            });
            const hex40Map = await idHex40Map(Array.from(hex40IdSet));
            // fields mapping
            list.forEach(row=>{
                row['transactionHash'] = `0x${row['transactionHash']}`;
                row['from'] = format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId);
                row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
            })
        }
        return {total: page?.count || 0, list};
    }
}
