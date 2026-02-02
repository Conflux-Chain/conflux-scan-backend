// @ts-ignore
import {Conflux, CONST as SDK_CONST, format} from "js-conflux-sdk";
import {Op, QueryTypes} from "sequelize"
import {
    AddressTransactionIndex,
    BlockPage,
    FailedTx,
    FullBlock,
    FullTransaction,
    pagingFullBlock,
    pagingFullTx,
    TxPage
} from "../model/FullBlock";
import {FullMinerBlock} from "../model/FullMinerBlock";
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
import {detectFishingAddress} from "./tool/phishingAddress";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {JsonRpcProvider} from "@ethersproject/providers/src.ts/json-rpc-provider";
import {fillMethodInfo} from "./contract/contractTool";

const limitMap = require('limit-map');

const lodash = require('lodash');
const BigFixed = require('bigfixed');

export class FullBlockQuery {
    protected app;
    protected sponsorContract;
    public constructor(app: any) {
        this.app = app;
        this.sponsorContract = app.cfx.InternalContract('SponsorWhitelistControl');
    }

    // Notice: remember to update `otherFilter` logic when adjust params
    public async listBlock({minEpochNumber = undefined, maxEpochNumber = undefined, blockHash = undefined,
                               minTimestamp = undefined, maxTimestamp = undefined, miner = undefined,
                               skip = 0, limit = 10}) {
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
        let count = 0;
        if(blockHash){
            rawList = await FullBlock.findAll(options);
            count = rawList?.length;
        }else if(minerId){
            const minerOptions = {...options};
            const page = await FullMinerBlock.findAndCountAll(minerOptions);
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
                const extInfo = JSON.parse(row['extra'] || '{}');
                const minerId = row['miner'];
                if(minerId && hex40Map.get(minerId)){
                    row['miner'] = fmtAddr(`0x${hex40Map.get(minerId)}`, StatApp.networkId);
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                row['pivotHash'] = row['pivotHash'] ? row['hash'] : undefined;
                if(row['totalReward'] === '0'){
                    row['totalReward'] = undefined;
                }
                row['burntGasFee'] = row.burntFee
                if(StatApp.isEVM) {
                    row['crossSpaceTransactionCount'] = extInfo['crossSpaceTxCount'] || 0
                    row['transactionCount'] = row['transactionCount']
                    row['executedTransactionCount'] = row['executedTransactionCount']
                    if (NoCoreSpace) {
                        row['coreBlock'] = 0;
                    } else {
                        const evmBlockCnt = row.height % 5 == 0 ? 1 : 0;
                        row['coreBlock'] = evmBlockCnt ? 0 : 1;
                        if (evmBlockCnt) {
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

        const result = {total: (count ? count : 0) + prunedCntr, list, paging, useEpochRangeForBlockExt: false};
        return result;
    }
    public async listTransaction({minEpochNumber = undefined, maxEpochNumber = undefined, blockHash = undefined, transactionHash = undefined,
                                     nonce = undefined, minTimestamp = undefined, maxTimestamp = undefined,
                                     accountAddress = undefined, from = undefined, to = undefined, opponentAddress = undefined,
                                     txType = undefined, status = undefined, skip = 0, limit = 10,
                                     verboseAddress = false, sort = 'DESC', useCountCache = true
    }) {
        sort = (sort === 'DESC' || sort === 'desc') ? 'DESC' : 'ASC'
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
            || (opponentAddress !== undefined && opponentAddressId === undefined)
            || (from !== undefined && fromAddressId === undefined)
            || (to !== undefined && toAddressId === undefined)){
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
            'method',
        ];
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
        let phishingInfo: any = {};
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

            const toIdArr = [];
            // fields mapping
            list.forEach(row=>{
                toIdArr.push(row['to'] ?? 0);
                row['from'] = fmtAddr(`0x${hex40Map.get(row['from'])}`, StatApp.networkId, verboseAddress);
                row['to'] = row['to'] ? fmtAddr(`0x${hex40Map.get(row['to'])}`, StatApp.networkId, verboseAddress) : null;
                if(hex40Map.get(row['contractCreated'])){
                    row['contractCreated'] = fmtAddr(`0x${hex40Map.get(row['contractCreated'])}`, StatApp.networkId);
                }
                if(row['contractCreated'] === 0){
                    row['contractCreated'] = null;
                }
                const timestampInSec =  row['timestamp'].getTime() / 1000;
                row['timestamp'] = timestampInSec;
                row['syncTimestamp'] = timestampInSec;
                row['blockHash'] = row['blockHash'].toString();
                row['nonce'] = row['nonce'].toString();
            })

            // method field mapping
            await fillMethodInfo(list, toIdArr).catch(error=>{
                safeAddErrorLog('open-api', 'list-transfer-fill-method', error);
            })

            if(accountAddressId){
                await detectFishingAddress(accountAddressId, list).then(res=>{
                    phishingInfo = res;
                }).catch(err=>{
                    console.log(`failed to detectFishing address`, err)
                })
            }
        }

        return {total: count, list, extraInfo, phishingInfo};
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
        const pagedCondition: any = {};
        const blockPage = await pagingFullBlock(skip);
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
        if (!eth) {
            return {message: 'eth is not available'};
        }
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
            if(blockNumber) {
                const proposedBlock = blockNumber;
                const confirmedBlock = BigInt(await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_CONFIRMED));
                const blockGap = Math.abs(Number(proposedBlock) - Number(confirmedBlock))
                if(blockGap > 100_000){
                    const pendingDetail = {
                        code: 31,
                        message: 'The block gap [proposedBlock confirmedBlock] exceeded 100,000',
                        params:{proposedBlock, confirmedBlock}
                    };
                    lodash.defaults(result, {pendingDetail});
                    return result;
                }
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

    public async listPendingTxEvmGeneral({accountAddress}) {
        const {eth} = this.app;
        if (!eth) {
            return {message: 'eth client is not available'}
        }

        // tx pool content
        const sdk = eth as JsonRpcProvider
        const {pending} = await eth.send('txpool_contentFrom', [accountAddress])
        if (!Object.keys(pending).length) {
            return new AccountPendingInfo()
        }

        // first pending tx
        const firstPendingNonce = String(Math.min(...Object.keys(pending).map(key => parseInt(key, 10))))
        const {from, to, nonce, value, gas: gasLimit, gasPrice} = pending[firstPendingNonce]

        // future nonce
        {
            const nextNonce = await sdk.getTransactionCount(accountAddress)
            if (parseInt(nonce) !== nextNonce) {
                const pendingDetail = {
                    code: 11,
                    message: 'The nonce in [stateNonce, txNonce) is skipped',
                    params: {txNonce: `${parseInt(nonce)}`, stateNonce: nextNonce}
                }
                return new AccountPendingInfo(pending, {pending: "futureNonce"}, pendingDetail)
            }
        }

        // insufficient balance
        {
            const gasFee = BigNumber.from(gasLimit).mul(BigNumber.from(gasPrice))
            const balance = await sdk.getBalance(from)
            const totalCost = BigNumber.from(value).add(BigNumber.from(gasFee))
            const insufficientBalance = BigNumber.from(balance).lt(BigNumber.from(totalCost))
            if (insufficientBalance) {
                const pendingDetail = {
                    message: 'The balance is insufficient to pay value + gasLimit * gasPrice',
                    params: {
                        balance,
                        value: BigNumber.from(value).toString(),
                        gasLimit: BigNumber.from(gasLimit).toString(),
                        gasPrice: BigNumber.from(gasPrice).toString()
                    },
                }
                if (to === null) {
                    pendingDetail['code'] = 21 // contract create
                } else if ((await sdk.getCode(to)) === '0x') {
                    pendingDetail['code'] = 22 // EOA
                } else {
                    pendingDetail['code'] = 20
                }
                return new AccountPendingInfo(pending, {pending: "notEnoughCash"}, pendingDetail)
            }
        }

        // ready
        {
            const pendingDetail = {
                code: 32,
                message: 'The transaction execution can be speed up by increasing the gasPrice appropriately',
            };
            return new AccountPendingInfo(pending, "ready", pendingDetail)
        }
    }
}

class AccountPendingInfo {
    pendingCount: number
    constructor(public pendingTransactions: any[] = [], public firstTxStatus: any = null, public pendingDetail: any = undefined) {
        this.pendingCount = pendingTransactions.length
    }
}
