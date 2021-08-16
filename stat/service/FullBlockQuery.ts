// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {
    FullBlock,
    FullTransaction,
    AddressTransactionIndex,
    pagingFullBlock,
    pagingFullTx,
    BlockPage, TxPage, FailedTx
} from "../model/FullBlock";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {ContractInfo, fillMethodInfo} from "../model/ContractInfo";
import {Hex40Map} from "../model/HexMap";
import {KEY_FULL_BLOCK_COUNT, KEY_FULL_TX_COUNT, KV} from "../model/KV";
const CONST = require('./common/constant');

export class FullBlockQuery {
    protected app;

    public constructor(app: any) {
        this.app = app;
    }

    public async listBlock({epochNumber, blockHash, minTimestamp, maxTimestamp, miner, skip = 0, limit = 10}) {
        const{ logger } = this.app;
        // parse para
        let minerId;
        if(miner){
            const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(miner).substr(2)}})
            minerId = hex40?.id
        }
        // check if exist
        if(miner !== undefined && minerId === undefined){
            return {total: 0, list: []};
        }
        // attributes
        const options: any = {offset: skip, limit, raw: true};
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
        // where
        const conditionArray = [];
        let paging:any|BlockPage = {}
        if(blockHash){
            conditionArray.push({hash: blockHash});
        }else if(minerId){
            conditionArray.push({minerId});
            if(minTimestamp && maxTimestamp) {
                conditionArray.push({ [Op.and]: [{createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}},
                        {createdAt: { [Op.lt]: new Date(maxTimestamp * 1000)}}]});
            }
            if(epochNumber){
                conditionArray.push({epoch: epochNumber});
            }
        } else{
            const {pagedCondition,blockPage} = await this.buildPagedBlockOptions(skip);
            paging = blockPage
            if(pagedCondition.where) {
                conditionArray.push(pagedCondition.where);
                options.offset = pagedCondition.skip;
            }
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        options.order = [['epoch', 'DESC'], ['position', 'DESC']];
        // query
        let rawList;
        let count;
        if(blockHash){
            rawList = await FullBlock.findAll(options);
            rawList = rawList?.filter(row => {
                let valid = true;
                const timestamp = new Date(row['timestamp']).getTime();
                if(epochNumber) valid = valid && (row['epochNumber'] === epochNumber);
                if(minTimestamp) valid = valid && (timestamp >= minTimestamp * 1000);
                if(maxTimestamp) valid = valid && (timestamp <= maxTimestamp * 1000);
                return valid;
            });
            count = rawList?.length;
        }else if(minerId){
            const minerOptions = {...options};
            minerOptions.attributes = ['minerId', 'epoch', 'position', 'createdAt'];
            const page = await FullMinerBlock.findAndCountAll(minerOptions);
            const epochSet = new Set();
            const positionSet = new Set();
            page?.rows?.forEach(row => {
                epochSet.add(row['epoch']);
                positionSet.add(row['position']);
            })
            const fullBlockMap = {};
            if(epochSet.size > 0 && positionSet.size > 0){
                const blockOptions = {...options};
                blockOptions.where = {epoch: {[Op.in]: Array.from(epochSet)}};
                blockOptions.offset = undefined;
                blockOptions.limit = undefined;
                const fullBlockList = await FullBlock.findAll(blockOptions);
                fullBlockList?.forEach(item => {
                    fullBlockMap[`${item['epochNumber']}-${item['blockIndex']}`] = item;
                });
            }
            rawList = page?.rows?.map(row => {
                return fullBlockMap[`${row['epoch']}-${row['position']}`];
            }).filter(Boolean);
            count = page.count;
        } else{
            rawList = await FullBlock.findAll(options);
            // use the value when paging.
            count = paging.calcTotal || await KV.getNumber(KEY_FULL_BLOCK_COUNT);
        }
        const list = [];
        if(rawList){
            const hex40IdSet = new Set<number>();
            rawList.forEach( row => {
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
            // fields mapping
            list.forEach(row=>{
                const minerId = row['miner'];
                if(minerId && hex40Map.get(minerId)){
                    row['miner'] = format.address(`0x${hex40Map.get(minerId)}`, this.app?.networkId);
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                row['pivotHash'] = row['pivotHash'] ? row['hash'] : undefined;
                if(row['totalReward'] === '0'){
                    row['totalReward'] = undefined;
                }
            })
        }
        const result = {total: count ? count : 0, list, paging};
        // logger?.info({src: `fullblockquery------------`, 'result': JSON.stringify(result)});
        return result;
    }

    public async listTransaction({minEpochNumber, maxEpochNumber, nonce,
                                     blockHash, transactionHash, minTimestamp, maxTimestamp,
                                     accountAddress, fromAddress, toAddress, opponentAddress,
                                     txType, status, skip = 0, limit = 10}) {
        const{ logger } = this.app;
        // parse para
        const addressMap = {};
        await Promise.all([accountAddress, fromAddress, toAddress, opponentAddress]
            .map(async ( address ) => {
                if(address){
                    const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}})
                    addressMap[address] =  hex40?.id;
                }
            })
        );
        let accountAddressId = addressMap[accountAddress];
        let fromAddressId = addressMap[fromAddress];
        let toAddressId = addressMap[toAddress];
        let opponentAddressId = addressMap[opponentAddress];
        // check if exist
        if((accountAddress !== undefined && accountAddressId === undefined)
            || (opponentAddress !== undefined && opponentAddressId === undefined)){
            return {total: 0, list: []};
        }
        // attributes
        const options: any = {offset: skip, limit, raw: true};
        options.attributes = [
            ['epoch', 'epochNumber'],
            ['blockPosition', 'blockHash'],
            'blockPosition',
            ['txPosition', 'transactionIndex'],
            'nonce',
            'hash',
            ['fromId', 'from'],
            ['toId', 'to'],
            ['dripValue', 'value'],
            'gasPrice',
            ['gas', 'gasFee'],
            ['createdAt', 'timestamp'],
            'status',
            ['contractCreatedId', 'contractCreated'],
        ];
        if(accountAddressId === undefined){
            options.attributes.push('method');
        }
        // where
        const conditionArray = [];
        let txPage:any | TxPage = {}
        if(blockHash){
            const block = await FullBlock.findOne({
                where: { hash: blockHash},
            });
            conditionArray.push({epoch: block?.epoch});
            conditionArray.push({blockPosition: block?.position});
        }
        if(accountAddressId){
            conditionArray.push({addressId: accountAddressId});
            if(minEpochNumber && maxEpochNumber){
                conditionArray.push({ [Op.and]: [{epoch: { [Op.gte]: minEpochNumber}},
                        {epoch: { [Op.lte]: maxEpochNumber}}]});
            }
            if(nonce){
                conditionArray.push({nonce: nonce});
            }
            if(minTimestamp && maxTimestamp) {
                conditionArray.push({ [Op.and]: [{createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}},
                        {createdAt: { [Op.lte]: new Date(maxTimestamp * 1000)}}]});
            }
            if(fromAddressId){
                conditionArray.push({fromId: fromAddressId});
            }
            if(toAddressId){
                conditionArray.push({toId: toAddressId});
            }
            if(opponentAddressId){
                const conditionOpponent = {};
                conditionOpponent[Op.or] = [{toId: opponentAddressId}, {fromId: opponentAddressId}, {contractCreatedId: opponentAddressId}];
                conditionArray.push(conditionOpponent);
            }
            if(transactionHash) {
                conditionArray.push({hash: transactionHash});
            }
            if(txType === CONST.TX_TYPE.IN){
                conditionArray.push({toId: accountAddressId});
            } else if(txType === CONST.TX_TYPE.OUT){
                conditionArray.push({fromId: accountAddressId});
            } else if(txType === CONST.TX_TYPE.FAIL || status === CONST.TX_STATUS.FAILED){
                conditionArray.push({
                    [Op.and]: [
                        {[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]},
                        {status: CONST.TX_STATUS.FAILED},
                    ]
                });
            } else if(txType === CONST.TX_TYPE.CREATE){
                conditionArray.push({contractCreatedId: {[Op.gt]: 0}});
            } else{
                conditionArray.push({[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]});
            }
        } else{
            const {pagedCondition, txPage: tp0} = await this.buildPagedTxOptions(skip);
            txPage = tp0
            if(pagedCondition.where){
                conditionArray.push(pagedCondition.where);
                options.offset = pagedCondition.skip;
            }
        }
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        options.order = [['epoch', 'DESC'], ['blockPosition', 'DESC'], ['txPosition', 'DESC']];
        // query
        let rawList;
        let count;
        if(accountAddressId){
            const page = await AddressTransactionIndex.findAndCountAll(options);
            rawList = page?.rows;
            count = page?.count;
        } else if(blockHash){
            const page = await FullTransaction.findAndCountAll(options);
            rawList = page?.rows;
            count = page?.count;
        } else{
            rawList = await FullTransaction.findAll(options);
            count = txPage.calcTotal || await KV.getNumber(KEY_FULL_TX_COUNT);
        }
        const list = [];
        let extraInfo = {dataSource:'rdb'}
        if(rawList){
            const txHashArray = [];
            const hex40IdSet = new Set<number>();
            const failedQuery:Promise<FailedTx>[] = []
            rawList.forEach( row => {
                txHashArray.push(row['hash']);
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['contractCreated']);
                list.push(row);
                if (row['status']) {
                    failedQuery.push(FailedTx.findOne({where:{
                        epoch: row['epochNumber'], blockPosition: row['blockPosition'], txPosition:row['transactionIndex']
                        }}).then(ft=>{
                            if (ft) {
                                row['txExecErrorMsg'] = ft.txExecErrorMsg;
                            } else {
                                row['txExecErrorMsg'] = 'txExecErrorMsgNotFound'
                            }
                            return ft
                    }))
                }
            });

            // prepare hex map and fill exec-error-msg
            const [hex40Array,failedArr] = await Promise.all([
                Hex40Map.findAll({
                where: {id: { [Op.in]: Array.from(hex40IdSet)}},
            }), Promise.all(failedQuery)])
            const hex40Map = new Map<number, string>()
            hex40Array.forEach(hex40=>{
                hex40Map.set(hex40.id, hex40.hex)
            })

            // prepare method map
            const methodMap = new Map<string,FullTransaction>()
            if (accountAddressId) {
                // fetch method, consider save it.
                const methodList = await FullTransaction.findAll({where:{hash:{[Op.in]:txHashArray}},
                    attributes:['hash','method']})
                methodList.forEach(row=>methodMap.set(row.hash, row))
            }

            // fields mapping
            list.forEach(row=>{
                row['from'] = format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId, true);
                row['to'] = row['to'] ? format.address(`0x${hex40Map.get(row['to'])}`, this.app?.networkId, true) : null;
                if(hex40Map.get(row['contractCreated'])){
                    row['contractCreated'] = format.address(`0x${hex40Map.get(row['contractCreated'])}`, this.app?.networkId, true);
                }
                if(row['contractCreated'] === 0){
                    row['contractCreated'] = null;
                }
                if (accountAddressId) {
                    row['method'] = methodMap.get(row['hash'])?.method
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                row['blockHash'] = row['blockHash'].toString();
                row['nonce'] = row['nonce'].toString();
            })

            // method field mapping
            await fillMethodInfo(list).catch(err=>{
                extraInfo['fillMethodError'] = err
            })
        }
        return {total: count ? count : 0, list, extraInfo};
    }

    private async buildPagedBlockOptions(skip) : Promise<{blockPage:BlockPage, pagedCondition}>{
        const{ logger } = this.app;

        const pagedCondition: any = {};
        const blockPage = await pagingFullBlock(skip, logger);
        /** How to use the result:
         if (result.id === Infinity) : query without condition;
         else : query with epoch and position condition.
         SQL:
         select * from t
         where epoch < result.epoch or (epoch = result.epoch and position < result.position)
         order by epoch desc, position desc
         limit result.skip, N
         */
        if(blockPage?.id !== Infinity){
             pagedCondition.where = {
                [Op.or]: [
                    {epoch: {[Op.lt]: blockPage.epoch}},
                    {[Op.and]: [
                            {epoch: blockPage.epoch},
                            {position: {[Op.lte]: blockPage.position}},
                        ]},
                ]
            };
            pagedCondition.skip = blockPage.skip;
        }
        return {pagedCondition, blockPage};
    }

    private async buildPagedTxOptions(skip) : Promise<{txPage:TxPage, pagedCondition}>{
        const pagedCondition: any = {};
        const txPage = await pagingFullTx(skip);
        if(txPage?.id !== Infinity){
            pagedCondition.where = {
                [Op.or]: [
                    {epoch: {[Op.lt]: txPage.epoch}},
                    {[Op.and]: [
                            {epoch: txPage.epoch},
                            {blockPosition: {[Op.lt]: txPage.blockPosition}},
                        ]},
                    {[Op.and]: [
                            {epoch: txPage.epoch},
                            {blockPosition: txPage.blockPosition},
                            {txPosition: {[Op.lte]: txPage.txPosition}},
                        ]},
                ]
            };
            pagedCondition.skip = txPage.skip;
        }
        return {pagedCondition, txPage};
    }
}
