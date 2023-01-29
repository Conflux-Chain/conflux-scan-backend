// @ts-ignore
import {CONST as SDK_CONST, format} from "js-conflux-sdk";
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
import {Hex40Map, idHex40Map} from "../model/HexMap";
import {KEY_FULL_BLOCK_COUNT, KEY_FULL_TX_COUNT, KV} from "../model/KV";
import {PruneInfo, PruneType} from "../model/PruneInfo";
import {checkExist} from "./common/utils";
import {CONST} from "./common/constant"
import {TransferCount} from "../model/TransferCount";
import {Epoch} from "../model/Epoch";

const lodash = require('lodash');
/*const CONST = require('./common/constant');*/

export class FullBlockQuery {
    protected app;
    protected sdk;
    protected sponsorContract;
    protected recommendGasPrice = BigInt(0);

    public constructor(app: any) {
        this.app = app;
        this.sdk = app.cfxSDK || app.cfx;
        this.sponsorContract = this.sdk.InternalContract('SponsorWhitelistControl');
    }

    public async listBlock({minEpochNumber = undefined, maxEpochNumber = undefined, blockHash = undefined,
                               minTimestamp = undefined, maxTimestamp = undefined, miner = undefined,
                               skip = 0, limit = 10}) {
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
        if(minEpochNumber !== undefined ||  maxEpochNumber !== undefined ||  blockHash !== undefined
            || minerId !== undefined || minTimestamp !== undefined || maxTimestamp !== undefined){
            if(minEpochNumber !== undefined){
                conditionArray.push({epoch: { [Op.gte]: minEpochNumber}});
            }
            if(maxEpochNumber !== undefined){
                conditionArray.push({epoch: { [Op.lte]: maxEpochNumber}});
            }
            if(blockHash){
                conditionArray.push({hash: blockHash});
            }
            if(minerId) {
                conditionArray.push({minerId});
            }
            if(minTimestamp !== undefined) {
                conditionArray.push({createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}});
            }
            if(maxTimestamp !== undefined) {
                const maxTime = new Date(maxTimestamp * 1000);
                conditionArray.push({createdAt: { [Op.lt]: maxTime}});
                const epoch = await Epoch.findOne({
                    where: {timestamp: {[Op.gte]: maxTime}},
                    order: [['timestamp', 'ASC']],
                });
                if(epoch) {
                    conditionArray.push({epoch: { [Op.lt]: epoch.epoch}});
                }
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
        } else if(minEpochNumber !== undefined &&  maxEpochNumber !== undefined &&  minEpochNumber === maxEpochNumber){
            const page = await FullBlock.findAndCountAll(options);
            rawList = page?.rows;
            count = page?.count || 0;
        } else{
            rawList = await FullBlock.findAll(options);
            count = paging.calcTotal || 0
            if (count < 0){
                count = await KV.getNumber(KEY_FULL_BLOCK_COUNT);
            }
        }
        // fields mapping
        const list = [];
        if(rawList){
            const hex40IdSet = new Set<number>();
            rawList.forEach( row => {
                hex40IdSet.add(row['miner']);
                list.push(row);
            });
            const hex40Map = await idHex40Map(Array.from(hex40IdSet));
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

        // add pruned total
        let prunedCntr = 0;
        const optionObj = {minEpochNumber, maxEpochNumber, blockHash, minTimestamp, maxTimestamp, miner};
        if(checkExist(optionObj, ['miner'])){
            const pruneInfo = await PruneInfo.findOne({where: {addressId: minerId, type: PruneType.MINER_BLOCK}});
            prunedCntr = pruneInfo !== null ? pruneInfo.pruned : 0;
        }

        const result = {total: (count ? count : 0) + prunedCntr, list, paging};
        return result;
    }
    public async listTransaction({minEpochNumber = undefined, maxEpochNumber = undefined, blockHash = undefined, transactionHash = undefined,
                                     nonce = undefined, minTimestamp = undefined, maxTimestamp = undefined,
                                     accountAddress = undefined, from = undefined, to = undefined, opponentAddress = undefined,
                                     txType = undefined, status = undefined, skip = 0, limit = 10,
                                     verboseAddress = false, sort = 'DESC', useCountCache = true
    }) {
        sort = (sort === 'DESC' || sort === 'desc') ? 'DESC' : 'ASC'
        const{ logger } = this.app;
        // parse para
        const addressMap = {};
        await Promise.all([accountAddress, from, to, opponentAddress]
            .map(async ( address ) => {
                if(address){
                    const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}})
                    addressMap[address] =  hex40?.id;
                }
            })
        );
        let accountAddressId = addressMap[accountAddress];
        let fromAddressId = addressMap[from];
        let toAddressId = addressMap[to];
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
            if(minEpochNumber !== undefined){
                conditionArray.push({epoch: { [Op.gte]: minEpochNumber}});
            }
            if(maxEpochNumber !== undefined){
                conditionArray.push({epoch: { [Op.lte]: maxEpochNumber}});
            }
            if(Number.isInteger(nonce)){
                conditionArray.push({nonce: nonce});
            }
            if(minTimestamp !== undefined) {
                conditionArray.push({createdAt: { [Op.gte]: new Date(minTimestamp * 1000)}});
            }
            if(maxTimestamp !== undefined) {
                conditionArray.push({createdAt: { [Op.lte]: new Date(maxTimestamp * 1000)}});
            }
            if(fromAddressId !== undefined && toAddressId === undefined){
                conditionArray.push({fromId: fromAddressId});
            }
            if(toAddressId !== undefined && fromAddressId === undefined){
                conditionArray.push({toId: toAddressId});
            }
            if(fromAddressId !== undefined &&  toAddressId !== undefined){
                conditionArray.push({[Op.or]: [{fromId: fromAddressId}, {toId: toAddressId}]});
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
                // conditionArray.push({[Op.or]: [{toId: accountAddressId}, {fromId: accountAddressId}]});
            }
        } else{
            const {pagedCondition, txPage: tp0} = await this.buildPagedTxOptions(skip);
            txPage = tp0
            if(pagedCondition.where){
                conditionArray.push(pagedCondition.where);
                options.offset = pagedCondition.skip;
            }
        }
        let isPureAddrQuery = false;
        if(conditionArray.length === 1){
            options.where = conditionArray[0];
            isPureAddrQuery = Boolean(accountAddressId);
        }
        if(conditionArray.length > 1){
            options.where = {[Op.and]: conditionArray};
        }
        // order
        options.order = [['epoch', sort], ['blockPosition', sort], ['txPosition', sort]];
        // query
        let rawList;
        let count = 0;
        if (isPureAddrQuery && useCountCache) {
            options.raw = true;
            let {list, finalCount} = await this.computeTxCount({accountAddressId, sort, options});
            rawList = list; count = finalCount;
        } else if(accountAddressId){
            const [page, pruneInfo] = await Promise.all([
                AddressTransactionIndex.findAndCountAll(options),
                PruneInfo.findOne({where: {addressId: accountAddressId, type: PruneType.ADDR_TX}}),
            ]);
            rawList = page?.rows;
            count = page?.count + (isPureAddrQuery ? (pruneInfo?.pruned || 0) : 0);
        } else if(blockHash){
            const page = await FullTransaction.findAndCountAll(options);
            rawList = page?.rows;
            count = page?.count;
        } else{
            rawList = await FullTransaction.findAll(options);
            count = txPage.calcTotal || 0
            if (count < 0) {
                count = await KV.getNumber(KEY_FULL_TX_COUNT);
            }
        }
        const list = [];
        let extraInfo = {dataSource:'rdb'}
        if(rawList){
            const txHashArray = [];
            const hex40IdSet = new Set<number>();
            const failedQuery:Promise<FailedTx>[] = [];
            const txHashQueryCondition = [];
            rawList.forEach( row => {
                txHashArray.push(row['hash']);
                hex40IdSet.add(row['from']);
                hex40IdSet.add(row['to']);
                hex40IdSet.add(row['contractCreated']);
                txHashQueryCondition.push({
                    [Op.and]:[{epoch: row['epochNumber'], blockPosition:row['blockPosition'], txPosition:row['transactionIndex']}]
                });
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
                /*const methodList = await FullTransaction.findAll({where:{hash:{[Op.in]:txHashArray}},
                    attributes:['hash','method']})*/
                const methodList = await FullTransaction.findAll({attributes: ['hash','method'],
                    where: {[Op.or]: txHashQueryCondition}});
                methodList.forEach(row=>methodMap.set(row.hash, row))
            }

            // fields mapping
            list.forEach(row=>{
                row['from'] = format.address(`0x${hex40Map.get(row['from'])}`, this.app?.networkId, verboseAddress);
                row['to'] = row['to'] ? format.address(`0x${hex40Map.get(row['to'])}`, this.app?.networkId, verboseAddress) : null;
                if(hex40Map.get(row['contractCreated'])){
                    row['contractCreated'] = format.address(`0x${hex40Map.get(row['contractCreated'])}`, this.app?.networkId);
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

        return {total: count, list, extraInfo};
    }

    async computeTxCount({accountAddressId, sort, options}) {
        let finalCount: number;
        let [list, pruneInfo, countCache, newestTx] = await Promise.all([
            AddressTransactionIndex.findAll(options),
            PruneInfo.findOne({where: {addressId: accountAddressId, type: PruneType.ADDR_TX}, raw: true,}),
            TransferCount.findOne({where: {addressId: accountAddressId, type: 'TX'}, raw: true,}),
            new Promise(r=>{
                if (sort === 'DESC') {
                    r(undefined);
                } else {
                    // options.order = [['epoch', sort], ['blockPosition', sort], ['txPosition', sort]];
                    options.order.forEach(o=>o[1] = 'DESC');
                    const queryParam = {...options, limit: 1}
                    delete queryParam.offset;
                    AddressTransactionIndex.findOne(queryParam).then(row=>{
                        r(row);
                    })
                }
            })
        ]);
        if (sort === 'DESC') {
            newestTx = list[0];
        }
        if (countCache
            // cache time should be later than newest tx
            // @ts-ignore
            && (countCache.updatedAt.getTime() > newestTx?.timestamp.getTime())
        ) {
            finalCount = countCache.v; // cached value is db count + pruned count, since pruning may be under progress.
        } else {
            const countParam = {where: options.where}
            let count = await AddressTransactionIndex.count(countParam);
            finalCount = count + (pruneInfo?.pruned || 0);
            if (finalCount) {
                await TransferCount.upsert({addressId: accountAddressId, v: finalCount, type: 'TX', updatedAt: new Date()})
            }
        }
        return {list, finalCount};
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

    public async batchGetTransactionList({hashArray}): Promise<any> {
        const txMap = {};
        const receiptMap = {};
        let total = hashArray?.length;
        if (!total) {
            return txMap;
        }

        let curPage = 1;
        let skip = 0;
        let pageSize = 100;
        do {
            const txHashArray = hashArray.slice(skip, skip + pageSize)
            if (txHashArray?.length) {
                const {txArray, receiptArray} = await this.batchGetTransactionList0({hashArray: txHashArray});

                txArray?.forEach(item => item && (txMap[item.hash] = item));
                receiptArray?.forEach(item => item && (receiptMap[item.transactionHash] = item));
            }
            skip = (++curPage - 1) * pageSize;
        } while (skip <= total);
        return {txMap, receiptMap};
    }

    public async batchGetTransactionList0({hashArray}): Promise<any> {
        const rpcTxs = hashArray.map(hash=>{return {"method": "cfx_getTransactionByHash","params": [hash]}});
        const rpcReceipts = hashArray.map(hash=>{return {"method": "cfx_getTransactionReceipt","params": [hash]}});
        const rpcBoth = [...rpcTxs, ...rpcReceipts];
        const len = hashArray.length;
        return this.sdk.provider.batch(rpcBoth).then(arr=>{
            const txArray = arr.slice(0, len);
            const receiptArray = arr.slice(len);
            return {txArray, receiptArray};
        });
    }

    public async listPendingTx({accountAddress}){
        // check
        const result =  await this.sdk.getAccountPendingTransactions(accountAddress, undefined, 10);
        const {firstTxStatus, pendingTransactions} = result;
        if(!pendingTransactions?.length){
            return result;
        }

        // future nonce
        const {from ,to, value, nonce, gas, gasPrice, storageLimit, epochHeight} = pendingTransactions[0];
        const pending = firstTxStatus.pending;
        if(pending?.endsWith('Nonce')){
            const pendingDetail = {
                code: 11,
                message: 'The nonce in [stateNonce, txNonce) is skipped',
                params:{txNonce: nonce, stateNonce: await this.sdk.getNextNonce(from)}
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        // insufficient balance
        if(pending?.endsWith('Cash')){
            const gasFee = gas * gasPrice;
            const colFee = storageLimit * BigInt(10**18) / BigInt(1024);
            const {balance}  = await this.sdk.getAccount(from);
            const totalCost = value + gasFee + colFee;
            const pendingDetail = {
                message: 'The balance is insufficient to pay value + gas * gasPrice + storageLimit * (10^18/1024)',
                params:{balance, value, gas, gasPrice, storageLimit},
            };

            // contract create
            const isContractCreate = to === null;
            if(isContractCreate && balance < totalCost){
                lodash.defaults(result, {pendingDetail: lodash.assign(pendingDetail, {code: 21})});
                return result;
            }

            // EOA
            const {codeHash}  = await this.sdk.getAccount(to);
            const isEOA = codeHash === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
            if(isEOA && balance < totalCost){
                lodash.defaults(result, {pendingDetail: lodash.assign(pendingDetail, {code: 22})});
                return result;
            }

            // contract
            const sponsorInfo = await this.sdk.getSponsorInfo(to);
            const isWhitelisted = await this.sponsorContract.isWhitelisted(to, from);
            const {sponsorForGas, sponsorForCollateral, sponsorGasBound, sponsorBalanceForGas,
                sponsorBalanceForCollateral} = sponsorInfo;
            const sponsorForGasHex = format.hexAddress(sponsorForGas);
            const sponsorForColHex = format.hexAddress(sponsorForCollateral);

            const isGasFeeSponsored = sponsorForGasHex !== CONST.ZERO_ADDRESS && isWhitelisted &&
                gasFee <= sponsorGasBound && gasFee <= sponsorBalanceForGas;
            const isColFeeSponsored = sponsorForColHex !== CONST.ZERO_ADDRESS && isWhitelisted &&
                colFee <= sponsorBalanceForCollateral;

            const partialCost = value + (isGasFeeSponsored ? BigInt(0) : gasFee) + (isColFeeSponsored ? BigInt(0) : colFee);
            if(balance < partialCost){
                lodash.assign(pendingDetail.params, {isWhitelisted, isGasFeeSponsored,isColFeeSponsored, sponsorInfo});
                lodash.defaults(result, {pendingDetail: lodash.assign(pendingDetail, {code: 23})});
                return result;
            }

            console.log(`
                firstTxStatus ${JSON.stringify(firstTxStatus)}
                from ${format.hexAddress(from)}
                to ${format.hexAddress(to)}
                value ${value}
                gasFee ${gasFee}
                    sponsorForGas ${sponsorForGasHex}
                    from isWhitelisted ${isWhitelisted}
                    sponsorGasBound ${sponsorGasBound}
                    sponsorBalanceForGas ${sponsorBalanceForGas}
                    covered ${gasFee <= sponsorGasBound && gasFee <= sponsorBalanceForGas}
                colFee ${colFee}
                    sponsorForCol ${sponsorForColHex}
                    from isWhitelisted ${isWhitelisted}
                    sponsorBalanceForCollateral ${sponsorBalanceForCollateral}
                    covered ${colFee <= sponsorBalanceForCollateral}
                cost ${partialCost}
                balance ${balance}
                covered ${balance >= partialCost}
            `);
            lodash.defaults(result, {pendingDetail: {code: 20, message: pending}});
            return result;
        }

        // ready
        if(firstTxStatus?.endsWith('ready')){
            const proposedEpoch = epochHeight;
            const confirmedEpoch = BigInt(await this.sdk.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_CONFIRMED));
            const epochGap = Math.abs(Number(proposedEpoch - confirmedEpoch));
            if(epochGap > 100_000){
                const pendingDetail = {
                    code: 31,
                    message: 'The epoch gap [proposedEpoch confirmedEpoch] exceeded 100,000',
                    params:{proposedEpoch, confirmedEpoch}
                };
                lodash.defaults(result, {pendingDetail});
                return result;
            }

            const pendingDetail = {
                code: 32,
                message: 'The transaction execution can be speed up by increasing the gasPrice appropriately',
                params:{gasPrice},
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        return result;
    }

    public async schedule(delay: number = 1000) {
        console.log(`schedule recommend_gas_price with delay:${delay}`)
        const that = this

        async function repeat() {
            await that.getRecommendGasPrice().catch(err =>{
                console.log(`schedule recommend_gas_price error:${err}`)
            })
            setTimeout(repeat, delay)
        }

        repeat().then()
    }

    private async getRecommendGasPrice() {
        const txList = await FullTransaction.findAll({
            attributes:['hash','gasPrice'],
            where:{status: 0},
            order: [['createdAt', 'desc']],
            limit: 100
        });
        if(!txList?.length) return;

        let sumGasPrice = BigInt(0);
        txList.forEach(tx => sumGasPrice = sumGasPrice + BigInt(tx.gasPrice));
        this.recommendGasPrice = sumGasPrice / BigInt(txList.length);
    }
}
