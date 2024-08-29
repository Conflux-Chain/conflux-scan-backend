// @ts-ignore
import {Conflux, CONST as SDK_CONST, format} from "js-conflux-sdk";
import {Op, QueryTypes} from "sequelize"
import {
    AddressTransactionIndex,
    BlockPage,
    FailedTx,
    FullBlock,
    FullBlockExt,
    FullTransaction, IFullBlock,
    pagingFullBlock,
    pagingFullTx,
    TxPage
} from "../model/FullBlock";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {fillMethodInfo} from "../model/ContractInfo";
import {Hex40Map, idHex40Map} from "../model/HexMap";
import {KEY_FULL_BLOCK_COUNT, KEY_FULL_TX_COUNT, KV} from "../model/KV";
import {PruneInfo, PruneType} from "../model/PruneInfo";
import {CONST} from "./common/constant"
import {TransferCount} from "../model/TransferCount";
import {Epoch} from "../model/Epoch";
import {BigNumber} from "ethers";
import {CoreSpaceRpc, fmtAddr, StatApp} from "../StatApp";
import {extractActualGasCost, initCfxSdk} from "./common/utils";
import {CoreDB, NoCoreSpace} from "../config/StatConfig";
import {init} from "./tool/FixDailyTokenStat";

const limitMap = require('limit-map');

const lodash = require('lodash');
const BigFixed = require('bigfixed');

export class FullBlockQuery {
    protected app;
    protected sponsorContract;
    protected recommendGasPrice = BigInt(0);
    public constructor(app: any) {
        this.app = app;
        this.sponsorContract = app.cfx.InternalContract('SponsorWhitelistControl');
    }

    // Notice: remember to update `otherFilter` logic when adjust params
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
        let rawList: any[];
        let count;
        let useEpochRangeForBlockExt = true;
        if(blockHash){
            rawList = await FullBlock.findAll(options);
            count = rawList?.length;
        }else if(minerId){
            useEpochRangeForBlockExt = false;
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
        // cross space tx
        const epochCrossSpaceTxMap = {}
        let epochHasEvmBlockMap = {}
        const epochBlockExtMap = {}
        let shouldRefToCore = false;
        if(rawList?.length) {
            let blockExts: FullBlockExt[];
            if (useEpochRangeForBlockExt) {
                blockExts = await FullBlockExt.sequelize.query(
                  `select * from full_block_ext where epoch>=? and epoch<=?`,
                  {type: QueryTypes.SELECT, replacements: [rawList[rawList.length - 1].epochNumber, rawList[0].epochNumber]});
            } else {
                // blocks of a miner may cross too large epoch gap
                blockExts = []
                await Promise.all(
                  rawList.map(b=>
                    FullBlockExt.findOne({where: {epoch: b["epochNumber"], position: b["blockIndex"]}})
                        .then(ext=>ext && blockExts.push(ext))
                  )
                );
            }
            for (const blockExt of blockExts) {
                // epochHasEvmBlockMap[blockExt['epoch']] = blockExt['coreBlock']
                if (!blockExt || !blockExt.extra) {
                    continue
                }
                // if(blockExt?.extra) // cpu bursts 100% here, amazing.
                epochBlockExtMap[`${blockExt.epoch}-${blockExt.position}`] = JSON.parse(blockExt.extra);
            }
            if(StatApp.isEVM && !NoCoreSpace) {
                const txCounts = await FullTransaction.sequelize.query(
                  `select epoch, count(*) as cntr from full_tx where epoch>=? and epoch<=? and gasPrice=0 group by epoch`,
                  { type: QueryTypes.SELECT, replacements: [rawList[rawList.length - 1].epochNumber, rawList[0].epochNumber]})
                txCounts.forEach(txCount => epochCrossSpaceTxMap[txCount['epoch']] = txCount['cntr'])
                shouldRefToCore = blockExts.filter(ext=>ext.coreBlock == -1).length == rawList.length;
                if (shouldRefToCore) {
                    epochHasEvmBlockMap = await queryEvmBlockCountInEachEpoch(rawList[rawList.length - 1].epochNumber, rawList[0].epochNumber);
                } else {
                    epochHasEvmBlockMap = await queryBlockByEpochRangeRpc(rawList[rawList.length - 1].epochNumber, rawList[0].epochNumber);
                }
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
                    row['miner'] = fmtAddr(`0x${hex40Map.get(minerId)}`, this.app?.networkId);
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                row['pivotHash'] = row['pivotHash'] ? row['hash'] : undefined;
                if(row['totalReward'] === '0'){
                    row['totalReward'] = undefined;
                }
                row['burntGasFee'] = epochBlockExtMap[`${row['epochNumber']}-${row['blockIndex']}`]?.burntFee
                if(StatApp.isEVM) {
                    row['crossSpaceTransactionCount'] = epochCrossSpaceTxMap[row['epochNumber']] || 0
                    row['transactionCount'] = row['transactionCount']
                    row['executedTransactionCount'] = row['executedTransactionCount']
                    if (NoCoreSpace) {
                        row['coreBlock'] = 0;
                    } else {
                        const evmBlockCnt = epochHasEvmBlockMap[row['epochNumber']];
                        row['coreBlock'] = evmBlockCnt ? 0 : 1;
                        if (evmBlockCnt) {
                            if (shouldRefToCore) {
                                const proportion = CONST.GAS_LIMIT_PROPORTION.evm;
                                row['gasLimit'] = BigInt(row['gasLimit']) * BigInt(100 * evmBlockCnt * proportion) / BigInt(100);
                            }
                        } else {
                            row['gasLimit'] = BigInt(0);
                        }
                    }
                }
            })
        }

        // add pruned total
        let prunedCntr = 0;
        const otherFilter = minEpochNumber ?? maxEpochNumber ?? blockHash ?? minTimestamp ?? maxTimestamp ?? null
        if(minerId && otherFilter === null){
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
            // address tx table doesn't have this field
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
                                // using actualGasCost as gasFee when NotEnoughCash error occurs
                                const actualGasCost = extractActualGasCost(ft.txExecErrorMsg)
                                if(lodash.isNumber(actualGasCost)) {
                                    row['gasFee'] = BigFixed(actualGasCost)
                                }
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
                // fetch method, consider save it on table address tx.
                const methodList = await limitMap(txHashQueryCondition,
                    async (object) => {
                        return FullTransaction.findOne({
                            attributes: ['hash', 'method'],
                            where: object,
                        })
                    },
                    { limit: 100 },
                )
                /*const methodList = await FullTransaction.findAll({where:{hash:{[Op.in]:txHashArray}},
                    attributes:['hash','method']})*/
                // const methodList = await FullTransaction.findAll({attributes: ['hash','method'],
                //     where: {[Op.or]: txHashQueryCondition}});
                methodList.forEach(row=>methodMap.set(row?.hash, row))
            }

            // fields mapping
            list.forEach(row=>{
                row['from'] = fmtAddr(`0x${hex40Map.get(row['from'])}`, this.app?.networkId, verboseAddress);
                row['to'] = row['to'] ? fmtAddr(`0x${hex40Map.get(row['to'])}`, this.app?.networkId, verboseAddress) : null;
                if(hex40Map.get(row['contractCreated'])){
                    row['contractCreated'] = fmtAddr(`0x${hex40Map.get(row['contractCreated'])}`, this.app?.networkId);
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
        const{ cfx } = this.app;

        const rpcTxs = hashArray.map(hash=>{return {"method": "cfx_getTransactionByHash","params": [hash]}});
        const rpcReceipts = hashArray.map(hash=>{return {"method": "cfx_getTransactionReceipt","params": [hash]}});
        const rpcBoth = [...rpcTxs, ...rpcReceipts];
        const len = hashArray.length;
        return cfx.provider.batch(rpcBoth).then(arr=>{
            const txArray = arr.slice(0, len);
            const receiptArray = arr.slice(len);
            return {txArray, receiptArray};
        });
    }

    public async listPendingTx({accountAddress}){
        const{ cfx } = this.app;

        // check
        const result =  await cfx.getAccountPendingTransactions(accountAddress, undefined, 10);
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
                params:{txNonce: nonce, stateNonce: await cfx.getNextNonce(from)}
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        // insufficient balance
        if(pending?.endsWith('Cash')){
            const gasFee = gas * gasPrice;
            const colFee = storageLimit * BigInt(10**18) / BigInt(1024);
            const {balance}  = await cfx.getAccount(from);
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
            const {codeHash}  = await cfx.getAccount(to);
            const isEOA = codeHash === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
            if(isEOA && balance < totalCost){
                lodash.defaults(result, {pendingDetail: lodash.assign(pendingDetail, {code: 22})});
                return result;
            }

            // contract
            const sponsorInfo = await cfx.getSponsorInfo(to);
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

        // oldEpochHeight
        if(pending === 'oldEpochHeight'){
            const pendingDetail = {
                code: 41,
                message: 'The epoch height of the first tx is too old to be packed. The sender needs to submit a new transaction to update the tx pool.',
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        // outdatedStatus
        if(pending === 'outdatedStatus'){
            const pendingDetail = {
                code: 51,
                message: 'The full node internal error. The sender needs to submit a new transaction to update the tx pool.',
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        // ready
        if(firstTxStatus?.endsWith('ready')){
            const proposedEpoch = epochHeight;
            const confirmedEpoch = BigInt(await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_CONFIRMED));
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

    public async listPendingTxEvm({accountAddress}){
        const{ cfx, eth } = this.app;

        // check
        const result = await eth.send('eth_getAccountPendingTransactions', [accountAddress, undefined, '10']);
        const {firstTxStatus, pendingTransactions} = result;
        if(!pendingTransactions?.length){
            return result;
        }

        // future nonce
        const {from ,to, nonce, value, gas: gasLimit, gasPrice, blockNumber} = pendingTransactions[0];
        const pending = firstTxStatus.pending;
        if(pending?.endsWith('Nonce')){
            const pendingDetail = {
                code: 11,
                message: 'The nonce in [stateNonce, txNonce) is skipped',
                params:{txNonce: `${parseInt(nonce)}`, stateNonce: await cfx.getNextNonce(from)}
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        // insufficient balance
        if(pending?.endsWith('Cash')){
            const gasFee = BigNumber.from(gasLimit).mul(BigNumber.from(gasPrice));
            const {balance} = await cfx.getAccount(from);
            const totalCost = BigNumber.from(value).add(BigNumber.from(gasFee));
            const insufficientBalance = BigNumber.from(balance).lt(BigNumber.from(totalCost));
            const pendingDetail = {
                message: 'The balance is insufficient to pay value + gasLimit * gasPrice',
                params: {
                    balance,
                    value: BigNumber.from(value).toString(),
                    gasLimit: BigNumber.from(gasLimit).toString(),
                    gasPrice: BigNumber.from(gasPrice).toString()
                },
            };

            // contract create
            const isContractCreate = to === null;
            if(isContractCreate && insufficientBalance){
                lodash.defaults(result, {pendingDetail: lodash.assign(pendingDetail, {code: 21})});
                return result;
            }

            // EOA
            const {codeHash}  = await cfx.getAccount(to);
            const isEOA = codeHash === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
            if(isEOA && insufficientBalance){
                lodash.defaults(result, {pendingDetail: lodash.assign(pendingDetail, {code: 22})});
                return result;
            }

            console.log(`
                firstTxStatus ${JSON.stringify(firstTxStatus)}
                from ${format.hexAddress(from)}
                to ${format.hexAddress(to)}
                value ${value}
                gasFee ${gasFee}
                cost ${totalCost}
                balance ${balance}
                covered ${isContractCreate}
            `);
            lodash.defaults(result, {pendingDetail: {code: 20, message: pending}});
            return result;
        }

        // oldBlockHeight
        if(pending === 'oldBlockHeight'){
            const pendingDetail = {
                code: 41,
                message: 'The block height of the first tx is too old to be packed. The sender needs to submit a new transaction to update the tx pool.',
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        // outdatedStatus
        if(pending === 'outdatedStatus'){
            const pendingDetail = {
                code: 51,
                message: 'The full node internal error. The sender needs to submit a new transaction to update the tx pool.',
            };
            lodash.defaults(result, {pendingDetail});
            return result;
        }

        // ready
        if(firstTxStatus?.endsWith('ready')){
            const proposedBlock = blockNumber;
            const confirmedBlock = BigInt(await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_CONFIRMED));
            const blockGap = Math.abs(Number(proposedBlock - confirmedBlock));
            if(blockGap > 100_000){
                const pendingDetail = {
                    code: 31,
                    message: 'The block gap [proposedBlock confirmedBlock] exceeded 100,000',
                    params:{proposedBlock, confirmedBlock}
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

export async function queryEvmBlockCountInEachEpoch(epochMin: number, epochMax: number) {
    const sql = `select epoch, count(*) as blockCount, sum(coreBlock) as coreCount 
        from ${CoreDB}.${FullBlockExt.getTableName()}
        where epoch between ${epochMin} and ${epochMax}
        group by epoch`;
    const arr = await FullBlockExt.sequelize.query(sql, {type: QueryTypes.SELECT, raw: true});
    // core space data may be absent, then query from chain rpc.
    if (arr.length != epochMax - epochMin + 1) {
        return queryBlockByEpochRangeRpc(epochMin, epochMax);
    }
    const ret = {}
    arr.forEach(row=>{
        ret[row['epoch']] = row['blockCount'] - row['coreCount'];
    })
    debugRpc && console.log(`debug block mark from DB `, ret);
    return ret;
}

let debugRpc: Conflux = null;

async function queryBlockByEpochRangeRpc(epochMin: number, epochMax: number) {
    const rpc = debugRpc || CoreSpaceRpc;
    if (!rpc) {
        return {}
    }
    let ret = {}
    const tasks = []
	  function fetch(epoch: number) {
        const task = rpc.getBlocksByEpochNumber(epoch).then(blocks=>{
            return Promise.all(blocks.map(hash=>{
                return rpc.getBlockByHash(hash, false)
            })).then(blockArr=>{
                ret[epoch] = blockArr.filter(b => b.height % 5 == 0).length;
            })
        }).catch(e=>{
            console.log(`failed to get block info, epoch ${epoch} . `, e)
        });
        tasks.push(task);
    }
    let cursor = epochMin;
    while(cursor <= epochMax) {
        fetch(cursor);
        cursor ++;
    }
    await Promise.all(tasks);
    debugRpc && console.log(`debug block mark from rpc`, ret);
    return ret;
}

async function main() {
    const[,,cmd, p1, p2] = process.argv;
    const cfg = await init();
    debugRpc = await initCfxSdk(cfg.conflux2);
    await queryEvmBlockCountInEachEpoch(parseInt(p1), parseInt(p2));
    await queryBlockByEpochRangeRpc(parseInt(p1), parseInt(p2));
    await FullBlockExt.sequelize.close();
}

// node stat/service/FullBlockQuery.js test 11102420  11102440
if (module == require.main) {
    main().then()
}
