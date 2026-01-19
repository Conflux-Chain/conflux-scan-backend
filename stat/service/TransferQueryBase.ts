// @ts-ignore
import {format} from "js-conflux-sdk";
import {IndexHints, Op} from "sequelize"
import {hex40IdMap, idHex40Map, Hex40Map} from "../model/HexMap";
import {FailedTx, FullTransaction} from "../model/FullBlock";
import {PruneInfo} from "../model/PruneInfo";
import {CONST} from "./common/constant"
import {TransferCount} from "../model/TransferCount";
import {fmtAddr, StatApp} from "../StatApp";
import {closestEpochByTimeStamp, ClosestType} from "../model/Epoch";
import {Token} from "../model/Token";
import {detectFishingAddress} from "./tool/phishingAddress";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {fillMethodInfo} from "./contract/contractTool";
const lodash = require('lodash');

export abstract class TransferQueryBase {
    protected app;
    protected NAME_TYPE_MAP;
    protected transferType;
    protected addrPruneType;
    protected addrModel;

    protected constructor(app: any) {
        this.app = app;
        this.NAME_TYPE_MAP = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'name');
    }

    public buildTokenIdOption(conditionArray: any[], tokenId: any) {
        conditionArray.push({tokenId: tokenId.toString()});
    }

    public async buildQueryOptions({minEpochNumber, maxEpochNumber, txParas, minTimestamp, maxTimestamp, accountAddressId,
        addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray, tokenId, transferType = undefined,
        txType, skip, limit, sort='DESC', cursor = undefined, cursorField = undefined}){
        sort = (sort === 'DESC' || sort === 'desc') ? 'DESC' : 'ASC'
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
        if(minTimestamp !== undefined) {
            const epochNumber = await closestEpochByTimeStamp(ClosestType.AFTER, minTimestamp)
            minEpochNumber = lodash.max([minEpochNumber, epochNumber])
        }
        if(maxTimestamp !== undefined) {
            const epochNumber = await closestEpochByTimeStamp(ClosestType.BEFORE, maxTimestamp)
            maxEpochNumber = lodash.min([maxEpochNumber, epochNumber])
        }
        if(minEpochNumber !== undefined) {
            conditionArray.push({epoch: { [Op.gte]: minEpochNumber}});
        }
        if(maxEpochNumber !== undefined) {
            conditionArray.push({epoch: { [Op.lte]: maxEpochNumber}});
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
        if(cursor !== undefined && cursor !== 0) {
            conditionArray.push({[cursorField]: {[sort === 'DESC' ? Op.lt : Op.gt]: cursor}});
            delete queryOptions.offset;
        }
        if(conditionArray.length === 1){
            queryOptions.where = conditionArray[0];
        }
        if(conditionArray.length > 1){
            queryOptions.where = {};
            queryOptions.where[Op.and] = conditionArray;
        }
        // order
        queryOptions.order = [['epoch', sort], ['blockIndex', sort], ['txIndex', sort],['txLogIndex', sort]];

        return queryOptions;
    }

    public getTransferType() {return this.transferType;}
    public getAddrPruneType() {return this.addrPruneType;}
    public abstract buildQueryFields({txType}): any;
    public abstract doQuery(options: any, queryOptions: any): Promise<any>;
    public abstract processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
        txMap: Map<string, FullTransaction>): Promise<any>;

    // Notice: remember to update `otherFilter` logic when adjust params
    public async listTransfer(options) {
        options.useCountCache = options.useCountCache ?? true;
        const {minEpochNumber, maxEpochNumber, transactionHash,
            minTimestamp, maxTimestamp,
            accountAddress, address, from, to, opponentAddress, tokenArray,
            tokenId, transferType, txType , status, skip = 0, limit = 10, sort, cursor, cursorField} = options;
        if(txType === CONST.TX_TYPE.FAIL || status === 1){
            return {total: 0, list: []};
        }

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
            if(!tx) {
                throw new Error(`Tx ${transactionHash} not found.`);
            }
            txParas = lodash.pick(tx, ['epoch', 'blockIndex', 'txIndex']);
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
        const queryOptions = await this.buildQueryOptions({
            minEpochNumber, maxEpochNumber, txParas,
            minTimestamp, maxTimestamp,
            accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray,
            tokenId, transferType, txType, skip, limit, sort, cursor, cursorField
        });
        queryOptions.attributes = this.buildQueryFields({txType});
        if(cursor !== undefined) {
            queryOptions.attributes.push([cursorField, 'cursor']);
        }
        if(options.txType === CONST.TX_TYPE.CREATE){
            queryOptions.attributes.push( ['traceIndex', 'transactionLogIndex']);
        } else if(options.accountAddress !== undefined){
            queryOptions.attributes.push( ['txLogIndex', 'transactionLogIndex']);
        } else{
            queryOptions.attributes.push(['id', 'transactionLogIndex']);
        }
        let phishingInfo: any = {};
        // query
        const page = await this.doQuery(options, queryOptions);
        const list = [];
        const toIdArr = [];
        if(page?.rows){
            const hex40IdSet = new Set<number>();
            // const txHashQueryCondition = []
            const mapTx = new Map<string, FullTransaction>()
            const txTasks = []
            page.rows.forEach( row => {
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['address']);
                // txHashQueryCondition.push({[Op.and]:[{epoch: row['epochNumber'],
                //         blockPosition:row['blockIndex'], txPosition:row['txIndex']
                //     }]})
                txTasks.push(
                    FullTransaction.findOne({
                        attributes: ['epoch', 'blockPosition', 'txPosition', 'hash', 'nonce', 'method', 'status', 'gas'],
                        where: {epoch: row['epochNumber'],
                            blockPosition:row['blockIndex'], txPosition:row['txIndex']
                        },
                        raw: true,
                    }).then(tx=>{
                        tx && mapTx.set(`${tx.epoch}_${tx.blockPosition}_${tx.txPosition}`, tx)
                    })
                )
                list.push(row);
            });
            await Promise.all(txTasks)
            const [hex40Map, txMap] = await Promise.all([
                idHex40Map(Array.from(hex40IdSet)),
                // this query is very slow if there are more than 1K rows
                // FullTransaction.findAll({attributes: ['epoch','blockPosition','txPosition','hash', 'nonce', 'method', 'status', 'gas'],
                //     where: {[Op.or]: txHashQueryCondition}}).then(list=>{
                //     const map = new Map<string, FullTransaction>()
                //     list.forEach(tx=>map.set(`${tx.epoch}_${tx.blockPosition}_${tx.txPosition}`, tx))
                //     return map
                // })
                Promise.resolve(mapTx)
            ]);

            // fields mapping
            list.forEach(row=>{
                toIdArr.push(row['to'] ?? 0);
                const key:string = `${row['epochNumber']}_${row['blockIndex']}_${row['txIndex']}`;
                row['transactionHash'] = txMap.get(key)?.hash
                    || `0x${row['transactionHash']}`
                    || '';
                row['from'] = hex40Map.get(row['from']) ? fmtAddr(`0x${hex40Map.get(row['from'])}`, StatApp.networkId) : '';
                row['to'] = hex40Map.get(row['to']) ? fmtAddr(`0x${hex40Map.get(row['to'])}`, StatApp.networkId) : '';
                row['timestamp'] = options.txType === CONST.TX_TYPE.CREATE ? row['timestamp']
                    : row['timestamp'].getTime() / 1000;
                row['syncTimestamp'] = row['timestamp'];
                this.processQueryResult(row, hex40Map, undefined, txMap);
            })
        }

        // add tx info
        if(this.getTransferType() === CONST.TRANSFER_TYPE.ALL) {
            await fillMethodInfo(list, toIdArr, true).catch(error=>{
                safeAddErrorLog('open-api', 'list-transfer-fill-method', error);
            })
            const failedQuery:Promise<FailedTx>[] = []
            list.forEach(row=>{
                if(row['type'] !== CONST.ADDRESS_TRANSFER_TYPE.TX.name) return;
                if (row['status']) {
                    failedQuery.push(FailedTx.findOne({where:{
                            epoch: row['epochNumber'], blockPosition: row['blockIndex'], txPosition:row['txIndex']
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
        } else if (accountAddressId) {
            await detectFishingAddress(accountAddressId, list, this.getTransferType()).then(res=>{
                phishingInfo = res;
            }).catch(err=>{
                console.log(`${__filename} failed to detectFishing address`, err);
            })
        }

        // add pruned total
        let prunedCntr = 0;
        if (!page.queryWithCache) {
            const otherFilter = minEpochNumber ?? maxEpochNumber ?? transactionHash ?? minTimestamp ?? maxTimestamp ??
                address ?? from ?? to ?? opponentAddress ?? tokenArray ?? tokenId ?? transferType ?? txType ?? status ?? null
            if (accountAddressId && otherFilter === null) {
                let pruneType = this.getAddrPruneType();
                if (pruneType) {
                    const pruneInfo = await PruneInfo.findOne({where: {addressId: accountAddressId, type: pruneType}});
                    prunedCntr = pruneInfo !== null ? pruneInfo.pruned : 0;
                }
            }
        }
        let next;
        if(cursor !== undefined) {
            next = list?.length ? list[list.length - 1]['cursor'] : 0;
        }
        const result = {total: (page?.count || 0) + prunedCntr, next, list, accountId: accountAddressId,
            queryWithCache: page.queryWithCache, hitCache: page.hitCache,
            phishingInfo,
        };
        return result;
    }

    protected async queryWithCache(queryOptions, options) {
        const {where:{addressId}, order:[[,sort]]} = queryOptions;
        let [countCache, rows, pruneInfo, newestTx] = await Promise.all([
            TransferCount.findOne({where: {addressId, type: this.transferType}, raw: true,}),
            this.addrModel.findAll(queryOptions),
            PruneInfo.findOne({where: {addressId, type: this.addrPruneType}}),
            new Promise(r=>{
                if (sort === 'DESC') {
                    r(undefined);
                } else {
                    // options.order = [['epoch', sort], ['blockPosition', sort], ['txPosition', sort]];
                    queryOptions.order.forEach(o=>o[1] = 'DESC');
                    const queryParam = {...queryOptions, limit: 1}
                    delete queryParam.offset;
                    this.addrModel.findOne(queryParam).then(row=>{
                        r(row);
                    })
                }
            })
        ])
        if (sort === 'DESC') {
            newestTx = rows[0];
        }
        let finalCount;
        let hitCache = false;
        if (countCache
            // cache time should be later than prune time
            && (pruneInfo === null || countCache.updatedAt.getTime() > pruneInfo.updatedAt.getTime())
            // cache time should be later than newest tx
            // @ts-ignore
            && (!newestTx || countCache.updatedAt.getTime() > newestTx.timestamp.getTime())
        ) {
            // we have some cache already, these data do not include pruned count.
            finalCount = countCache.v + (pruneInfo?.pruned || 0);
            hitCache = true;
        } else {
            const countParam = {where: queryOptions.where}
            let count = await this.addrModel.count(countParam);
            finalCount = count + (pruneInfo?.pruned || 0);
            if (finalCount) {
                // @ts-ignore
                await TransferCount.upsert({addressId, v: count, type: this.transferType, updatedAt: newestTx?.timestamp || new Date()})
            }
        }
        return {count: Math.max(finalCount, rows.length) , rows, queryWithCache: true, hitCache};
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

        const queryOptions: any = {where: {contractId: addressId}, offset: skip, limit, raw: true};
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

    protected async queryByCursor(model, queryOptions) {
        const list = await model.findAll(queryOptions);

        delete queryOptions.attributes;
        if(queryOptions.where[Op.and]) {
            queryOptions.where[Op.and] = queryOptions.where[Op.and].filter(item => item.id === undefined);
        } else {
            delete queryOptions.where.id;
        }
        const count = await model.count(queryOptions);

        return {count, rows: list}
    }
}

export async function patchTokenTxQueryRange(token: Token, queryOptions: any, model: any/* = Erc20Transfer*/) {
    const n = 5000;
    let logging = undefined;
    // logging = console.log;
    queryOptions.logging = logging;
    if (!token || token.transfer > n) {
        // why erc1155 table use the wrong index idx_epoch ?
        queryOptions['indexHints'] = [{ type: IndexHints.USE, values: ['idx_contractId_epoch'] }];
        const {where, order, limit, offset, indexHints} = queryOptions;
        const [[_, sort]] = order;
        const SORT = sort.toUpperCase();
        const tailOne = await model.findOne({where, order: [order[0]], offset: limit + offset, indexHints, logging} as any);
        if (tailOne) {
            queryOptions.where['epoch'] = {[SORT == 'DESC' ? Op.gte : Op.lte]: tailOne.epoch}
        }
    }
}
