// @ts-ignore
import {format} from "js-conflux-sdk";
import {Op} from "sequelize"
import {hex40IdMap, idHex40Map, Hex40Map} from "../model/HexMap";
import {FailedTx, FullTransaction} from "../model/FullBlock";
import {PruneInfo, PruneType} from "../model/PruneInfo";
import {checkExist} from "./common/utils";
import {checkAddressRate} from "../router/RateLimiter";
import {CONST} from "./common/constant"
import {fillMethodInfo} from "../model/ContractInfo";
import {Errors} from "./common/LogicError";
import {TransferCount} from "../model/TransferCount";
const lodash = require('lodash');

export abstract class TransferQueryBase {
    protected app;
    protected NAME_TYPE_MAP;

    protected constructor(app: any) {
        this.app = app;
        this.NAME_TYPE_MAP = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'name');
    }

    public buildTokenIdOption(conditionArray: any[], tokenId: any) {
        conditionArray.push({tokenId: tokenId.toString()});
    }

    public buildQueryOptions({minEpochNumber, maxEpochNumber, txParas,
                                  minTimestamp, maxTimestamp,
                                  accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray,
                                  tokenId, transferType = undefined, txType, skip, limit, sort='DESC'}){
        sort = (sort === 'DESC' || sort === 'desc') ? 'DESC' : 'ASC'
        const{ logger } = this.app;
        // page
        const queryOptions: any = {offset: skip, limit, raw: true};
        // condition
        const conditionArray = [];
        if(accountAddressId){
            conditionArray.push({addressId: accountAddressId});
        }
        if(addressId){
            conditionArray.push({contractId: addressId});
        }
        if(tokenAddressIdArray.length){
            conditionArray.push({contractId: {[Op.in]: tokenAddressIdArray}});
        }
        if(minEpochNumber !== undefined) {
            conditionArray.push({epoch: { [Op.gte]: minEpochNumber}});
        }
        if(maxEpochNumber !== undefined) {
            conditionArray.push({epoch: { [Op.lte]: maxEpochNumber}});
        }
        if(minTimestamp !== undefined) {
            conditionArray.push({createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if(maxTimestamp !== undefined) {
            conditionArray.push({createdAt: { [Op.lte]: new Date(maxTimestamp * 1000)}});
        }
        if(fromAddressId !== undefined && toAddressId === undefined) {
            conditionArray.push({fromId: fromAddressId});
        }
        if(toAddressId !== undefined && fromAddressId === undefined) {
            conditionArray.push({toId: toAddressId});
        }
        if(fromAddressId !== undefined &&  toAddressId !== undefined) {
            conditionArray.push({[Op.or]: [{fromId: fromAddressId}, {toId: toAddressId}]});
        }
        if(opponentAddressId){
            conditionArray.push({[Op.or]: [{toId: opponentAddressId}, {fromId: opponentAddressId}]});
        }
        if(txParas) {
            conditionArray.push({epoch: txParas.epoch, blockIndex: txParas.blockIndex, txIndex: txParas.txIndex});
        }
        if(tokenId !== undefined) {
            // conditionArray.push({tokenId: tokenId.toString()});
            this.buildTokenIdOption(conditionArray, tokenId);
        }
        if(accountAddressId) {
            const transferCode = this.NAME_TYPE_MAP[transferType]?.code;
            if(transferCode){
                conditionArray.push({type: transferCode});
            }
            if (txType === CONST.TX_TYPE.IN) {
                conditionArray.push({toId: accountAddressId});
            } else if (txType === CONST.TX_TYPE.OUT) {
                conditionArray.push({fromId: accountAddressId});
            } else {
                // conditionArray.push({[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]});
            }
        }
        if(conditionArray.length === 1){
            queryOptions.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            queryOptions.where = {};
            queryOptions.where[Op.and] = conditionArray;
        }
        // order
        queryOptions.order = [['epoch', sort]];
        if(accountAddressId !== undefined){
            queryOptions.order.push(['blockIndex', sort], ['txIndex','desc'],['txLogIndex','desc']);
        }
        if(tokenAddressIdArray.length){
            queryOptions.order.push(['createdAt', sort]);
        }

        return queryOptions;
    }

    public abstract getTransferType(): string;
    public abstract getAddrPruneType(): string;
    public abstract buildQueryFields({txType}): any;
    public abstract doQuery(options: any, queryOptions: any): Promise<any>;
    public abstract processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
        txMap: Map<string, FullTransaction>): Promise<any>;

    public async listTransfer(options) {
        options.userCountCache = options.userCountCache ?? true;
        const{ logger, service: {fullBlockQuery} } = this.app;
        const {minEpochNumber, maxEpochNumber, transactionHash,
            minTimestamp, maxTimestamp,
            accountAddress, address, from, to, opponentAddress, tokenArray,
            tokenId, transferType, txType , status, skip = 0, limit = 10, sort} = options;
        if(txType === CONST.TX_TYPE.FAIL || status === 1){
            return {total: 0, list: []};
        }
        // if (address) {
            // await checkAddressRate(address)
        // }

        // parameter
        const addressMap = {};
        await Promise.all([accountAddress, address, from, to, opponentAddress]
            .map(async ( address ) => {
                if(address){
                    const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}})
                    addressMap[address] =  hex40?.id;
                }
            })
        );
        const accountAddressId = addressMap[accountAddress];
        const addressId = addressMap[address];
        const fromAddressId = addressMap[from];
        const toAddressId = addressMap[to];
        const opponentAddressId = addressMap[opponentAddress];
        let txParas;
        if(transactionHash){
            const tx = await FullTransaction.findOne({
                attributes: ['epoch', ['blockPosition', 'blockIndex'], ['txPosition','txIndex'], 'hash'],
                where: {hash: transactionHash}, raw: true});
            txParas = tx ? lodash.pick(tx, ['epoch', 'blockIndex', 'txIndex']) : undefined;
        }
        const tokenAddressIdArray = [];
        if(tokenArray?.length){
            const hex40Array = tokenArray.map((address) => format.hexAddress(address).substr(2));
            const hex40RecordArray = await Hex40Map.findAll({where: {hex: {[Op.in]: hex40Array}}})
            hex40RecordArray.forEach(row => {
                tokenAddressIdArray.push(row.id);
            });
        }

        // check if address exist
        if((accountAddress !== undefined && accountAddressId === undefined)
            || (address !== undefined && addressId === undefined)
            || (from !== undefined && fromAddressId === undefined)
            || (to !== undefined && toAddressId === undefined)
            || (opponentAddress !== undefined && opponentAddressId === undefined
            || (tokenArray !== undefined && tokenAddressIdArray?.length === 0))){
            return {total: 0, list: [], accountId: accountAddressId};
        }

        // queryOptions
        const queryOptions = this.buildQueryOptions({
            minEpochNumber, maxEpochNumber, txParas,
            minTimestamp, maxTimestamp,
            accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray,
            tokenId, transferType, txType, skip, limit, sort
        });
        queryOptions.attributes = this.buildQueryFields({txType});
        if(options.txType === CONST.TX_TYPE.CREATE){
            queryOptions.attributes.push( ['traceIndex', 'transactionLogIndex'],);
        } else if(options.accountAddress !== undefined){
            queryOptions.attributes.push( ['txLogIndex', 'transactionLogIndex'],);
        } else{
            queryOptions.attributes.push(['id', 'transactionLogIndex']);
        }

        // query
        const page = await this.doQuery(options, queryOptions);
        const list = [];
        if(page?.rows){
            const hex40IdSet = new Set<number>();
            const txHashQueryCondition = []
            page.rows.forEach( row => {
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['address']);
                txHashQueryCondition.push({[Op.and]:[{epoch: row['epochNumber'],
                        blockPosition:row['blockIndex'], txPosition:row['txIndex']
                    }]})
                list.push(row);
            });
            const [hex40Map, txMap] = await Promise.all([
                idHex40Map(Array.from(hex40IdSet)),
                FullTransaction.findAll({attributes: ['epoch','blockPosition','txPosition','hash', 'nonce', 'method', 'status', 'gas'],
                    where: {[Op.or]: txHashQueryCondition}}).then(list=>{
                    const map = new Map<string, FullTransaction>()
                    list.forEach(tx=>map.set(`${tx.epoch}_${tx.blockPosition}_${tx.txPosition}`, tx))
                    return map
                })
            ]);

            // fields mapping
            list.forEach(row=>{
                const key:string = `${row['epochNumber']}_${row['blockIndex']}_${row['txIndex']}`;
                row['transactionHash'] = txMap.get(key)?.hash
                    || `0x${row['transactionHash']}`
                    || '';
                row['from'] = hex40Map.get(row['from']) ? format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId) : '';
                row['to'] = hex40Map.get(row['to']) ? format.address(`0x${hex40Map.get(row['to'])}`, this.app?.networkId) : '';
                row['timestamp'] = options.txType === CONST.TX_TYPE.CREATE ? row['timestamp']
                    : row['timestamp'].getTime() / 1000;
                row['syncTimestamp'] = row['timestamp'];
                this.processQueryResult(row, hex40Map, undefined, txMap);
            })
        }

        // add tx info
        if(this.getTransferType() === CONST.TRANSFER_TYPE.ALL) {
            await fillMethodInfo(list).catch(error=>{ throw new Errors.BizError(`fill method info error, ${error}`);})
            const hashArray = [...new Set(lodash.map(list, item => item['transactionHash']))];
            const {txMap, receiptMap} = await fullBlockQuery.batchGetTransactionList({hashArray});
            const failedQuery:Promise<FailedTx>[] = []
            list.forEach(row=>{
                if(row['type'] !== CONST.ADDRESS_TRANSFER_TYPE.TX.name) return;
                row['storageFee'] = BigInt(receiptMap[row['transactionHash']]?.storageCollateralized || 0) * BigInt(10**18) / BigInt(1024);
                row['input'] = txMap[row['transactionHash']]?.data;
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
            await Promise.all(failedQuery);
        }

        // add pruned total
        let prunedCntr = 0;
        if (!page.queryWithCache) {
            const optionObj = {
                minEpochNumber, maxEpochNumber, transactionHash,
                minTimestamp, maxTimestamp,
                accountAddress, address, from, to, opponentAddress, tokenArray,
                tokenId, txType, status
            };
            if (checkExist(optionObj, ['accountAddress'])) {
                let pruneType = this.getAddrPruneType();
                if (pruneType) {
                    const pruneInfo = await PruneInfo.findOne({where: {addressId: accountAddressId, type: pruneType}});
                    prunedCntr = pruneInfo !== null ? pruneInfo.pruned : 0;
                }
            }
        }
        const result = {total: (page?.count || 0) + prunedCntr, list, accountId: accountAddressId};
        return result;
    }

    protected async queryWithCache(queryOptions, options, {transferType, pruneType, model}) {
        const {where:{addressId}, order:[[,sort]]} = queryOptions;
        let [countCache, rows, pruneInfo, newestTx] = await Promise.all([
            TransferCount.findOne({where: {addressId, type: transferType}, raw: true,}),
            model.findAll(queryOptions),
            PruneInfo.findOne({where: {addressId, type: pruneType}}),
            new Promise(r=>{
                if (sort === 'DESC') {
                    r(undefined);
                } else {
                    // options.order = [['epoch', sort], ['blockPosition', sort], ['txPosition', sort]];
                    options.order.forEach(o=>o[1] = 'DESC');
                    const queryParam = {...options, limit: 1}
                    delete queryParam.offset;
                    model.findOne(queryParam).then(row=>{
                        r(row);
                    })
                }
            })
        ])
        if (sort === 'DESC') {
            newestTx = rows[0];
        }
        let finalCount;
        if (countCache
            // cache time should be later than prune time
            && (pruneInfo === null || countCache.updatedAt.getTime() > pruneInfo.updatedAt.getTime())
            // cache time should be later than newest tx
            // @ts-ignore
            && (!newestTx || countCache.updatedAt.getTime() > newestTx.timestamp.getTime())
        ) {
            // we have some cache already, these data do not include pruned count.
            finalCount = countCache.v + (pruneInfo?.pruned || 0);
        } else {
            const countParam = {where: options.where}
            let count = await model.count(countParam);
            finalCount = count + (pruneInfo?.pruned || 0);
            if (finalCount) {
                // @ts-ignore
                await TransferCount.upsert({addressId, v: count, type: transferType, updatedAt: newestTx?.timestamp || new Date()})
            }
        }
        return {count: Math.max(finalCount, rows.length) , rows, queryWithCache: true};
    }

    public abstract doQueryAccountAddress(options: any, queryOptions: any): Promise<any>;

    /**
     * address: contract address
     * @param options
     */
    public async listAccountAddress(options) {
        const {address, skip = 0, limit = 10} = options;

        const addressHex = address && format.hexAddress(address).substr(2);
        const addressMap = await hex40IdMap([addressHex]);
        const addressId = addressMap?.get(addressHex);
        if(address !== undefined && addressId === undefined){
            return {total: 0, list: [], addressId, addressHex};
        }

        const queryOptions: any = {where: {contractId: addressId},
            offset: skip, limit, raw: true,
            //logging: console.log,
        };
        const page = await this.doQueryAccountAddress(options, queryOptions);
        let list ;
        if(page?.rows){
            const hex40IdSet = new Set<number>();
            page.rows.forEach( row => {
                hex40IdSet.add(row['addressId']);
            });
            const hex40Map = await idHex40Map(Array.from(hex40IdSet));
            list = [...hex40Map.values()];
        }
        return {total: list?.length || 0, list: list || [], addressId, addressHex};
    }
}
