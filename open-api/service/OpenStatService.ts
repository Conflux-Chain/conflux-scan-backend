import {StatApp} from "../../stat/StatApp";
import {
    checkPresent,
    getPagination,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent
} from "../../stat/service/common/utils";
import {setBody} from "../router/middleware";
import {getApiService} from "../ApiServer";
import {CONST} from "../../stat/service/common/constant"
import {ApprovalRelation} from "../../stat/ApprovalSync";
import {paginateCoreStat} from "../../stat/router/ParamChecker";
import {polishContract} from "./OpenContractService";
import {fixApprovalData} from "../../stat/service/tool/ApprovalTool";
import {BlockAndMinerSync} from "../../stat/service/BlockAndMinerSync";
import {CIP1559StatType} from "../../stat/service/DailyBlockDataStatQuery";

export async function listMiningStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day']);

    const {skip, limit, intervalType, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);

    const page = await getApiService().dailyBlockDataStatQuery.listMiningStat({intervalType, minTimestamp,  maxTimestamp,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTAssetStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit, } = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listNFTAssetStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTContractStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit} = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listNFTContractStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTTransferStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit} = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listNFTTransferStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTHolderStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['day','month']);
    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit} = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listNFTHolderStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function getSupplyStat(ctx) {
    const marketData = await getApiService().marketDataQuery.getMarketData();
    setBody(ctx, marketData);
}

export async function listTpsStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day']);

    const {skip, limit, intervalType, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);

    const page = await getApiService().dailyBlockDataStatQuery.listTpsStat({intervalType, minTimestamp,  maxTimestamp,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listContractStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().contractStatQuery.listDeployedContractStat({minTimestamp, maxTimestamp,
        sort, skip, limit});
    setBody(ctx, page)
}

export async function listApproval(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'account');
    mustBeEnumParamIfPresent(ctx.request.query, 'tokenType', ['ERC20','ERC721','ERC1155', 'CRC20','CRC721','CRC1155']);
    mustBeEnumParamIfPresent(ctx.request.query, 'byTokenId',
        ['false','true']);
    const {account, tokenType, byTokenId} = ctx.request.query;
    checkPresent({account, tokenType}, ['account']);
    const data = await ApprovalRelation.queryApprovalOfAccount({account, tokenType,
        byTokenId: byTokenId === 'true', cfx:getApiService().cfx})
    await polishContract(data)
    await fixApprovalData(data);
    setBody(ctx, data);
}

export async function listCfxHolderStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().cfxHolderQuery.listCfxHolderStat({minTimestamp, maxTimestamp,
        sort, skip, limit});
    setBody(ctx, page)
}

export async function listAccountGrowthStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().cfxHolderQuery.listAccountGrowthStat({minTimestamp, maxTimestamp,
        sort, skip, limit});
    setBody(ctx, page)
}

export async function listAccountActiveStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().cfxHolderQuery.listAccountActiveStat({minTimestamp, maxTimestamp,
        sort, skip, limit});
    setBody(ctx, page)
}

export async function listTransactionStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().dailyTxnQuery.listDailyTransactionStat({minTimestamp, maxTimestamp,
        sort, skip, limit, field: 'txCount'});
    setBody(ctx, page)
}

export async function listTransactionSenderStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().dailyTxnQuery.listDailyTransactionStat({minTimestamp, maxTimestamp,
        sort, skip, limit, field: 'senderCount'});
    setBody(ctx, page)
}

export async function listCfxTransferStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().dailyTxnQuery.listDailyCfxTransferStat({minTimestamp, maxTimestamp,
        sort, skip, limit});
    setBody(ctx, page)
}

export async function listTokenTransferStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort, contract} = parseStatParam(ctx);
    let page;
    if(!contract){
        page = await getApiService().dailyTxnQuery.listDailyTokenTransferStat({minTimestamp, maxTimestamp,
            sort, skip, limit});
    } else{
        page = await getApiService().dailyTxnQuery.listDailyTokenAnalysis({minTimestamp, maxTimestamp,
            sort, skip, limit, contract});
        page.list = page.list.map(item => ({ statTime: item.statTime, transferCount: item.transferCount,
            userCount: item.uniqueParticipantCount }));
    }
    setBody(ctx, page)
}

export async function listTokenHolderStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, holderCount: item.holderCount, }));
    setBody(ctx, page)
}

export async function listTokenUniqueSenderStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, uniqueSenderCount: item.uniqueSenderCount, }));
    setBody(ctx, page)
}

export async function listTokenUniqueReceiverStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, uniqueReceiverCount: item.uniqueReceiverCount, }));
    setBody(ctx, page)
}

export async function listTokenUniqueParticipantStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, uniqueParticipantCount: item.uniqueParticipantCount, }));
    setBody(ctx, page)
}

export async function listGasUsedTopStat(ctx) {
    const {span, type} = parseTopStatParam(ctx);
    const cache = getApiService().txnQuery.topGasUsedCache[`${span}${type}`]
    const data = {
        gasTotal: cache['totalGas'],
        maxTime: cache['cacheCreatedAt'],
        list: cache?.list.map(item => ({address: StatApp.isEVM ? item['hex'] : item['base32'], gas: item['gas']}))
    }
    setBody(ctx, data)
}

export async function listMinerTopStat(ctx) {
    const { span, type } = parseTopStatParam(ctx);
    const {list,allDifficulty} = await BlockAndMinerSync.topByType(span, type, 10);
    const timeRange = BlockAndMinerSync.calculateTimeRange(list);
    BlockAndMinerSync.calculateHashRate(list, timeRange.beginTime, timeRange.endTime);
    const data = {
        maxTime: timeRange.endTime,
        difficultyTotal: allDifficulty,
        list: list?.map(item => ({
            address: StatApp.isEVM ? `0x${item['miner']}` : item['base32'], value: item['value'],
            blockCntr: item['blockCount'],
            rewardSum: item['totalReward'],
            txFeeSum: item['txFee'],
            hashRate: item['hashRate'],
        })),
    };
    setBody(ctx, data)
}

export async function listCfxSenderTopStat(ctx) {
    await topCfxTransfer(ctx, 'cfxSend')
}

export async function listCfxReceiverTopStat(ctx) {
    await topCfxTransfer(ctx, 'cfxReceived')
}

export async function listTransactionSenderTopStat(ctx) {
    await topCfxTransfer(ctx, 'txnSend')
}

export async function listTransactionReceiverTopStat(ctx) {
    await topCfxTransfer(ctx, 'txnReceived')
}

async function topCfxTransfer(ctx, statType) {
    const { span, type } = parseTopStatParam(ctx);
    const cache: any = await getApiService().txnSync.txTopBy(span, type, 10, statType, StatApp.networkId);
    const data = {
        maxTime: cache['endTime'],
        valueTotal: cache['sum'],
        list: cache?.list.map(item => ({address: StatApp.isEVM ? item['hex'] : item['base32'], value: item['value']})),
    }
    setBody(ctx, data)
}

export async function listTokenTransferTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_transfers_')
}

export async function listTokenSenderTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_senders_')
}

export async function listTokenReceiverTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_receivers_')
}

export async function listTokenParticipantTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_participants_')
}

async function topTokenTransfer(ctx, statType) {
    const { span, type } = parseTopStatParam(ctx);
    const spanType = (span === 24 && type === 'h') ? '1d' : `${span}${type}`
    const topType = `${statType}${spanType}`
    const cache: any = await getApiService().rankService.top(topType, 10, StatApp.networkId)
    const data = {
        maxTime: cache['maxTimeStart'],
        list: cache?.list.map(item => ({address: StatApp.isEVM ? item['hex'] : item['base32address'], transferCntr: item['valueN']})),
    }
    setBody(ctx, data)
}

function parseStatParam(ctx) {
    mustBeIntParamIfPresent(ctx.request.query, 'minTimestamp', 'maxTimestamp', 'skip', 'limit');
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC', 'ASC']);
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');

    const sort = (ctx.request.query.sort || 'DESC').toLowerCase();
    const {skip, limit} = paginateCoreStat(ctx.request.query);
    const {intervalType, minTimestamp, maxTimestamp, contract} = ctx.request.query
    return {contract, minTimestamp, maxTimestamp, intervalType, sort, skip, limit};
}

function parseTopStatParam(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'spanType', ['24h', '3d', '7d']);
    const {spanType = '24h'} = ctx.request.query
    let span, type
    if(spanType.endsWith('h')) {
        type = 'h'
        span = 24
    } else{
        type = 'd'
        span = Number(spanType.substring(0, 1))
    }
    return {span, type};
}

async function getTokenAnalysisData(ctx){
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');

    const {contract, minTimestamp, maxTimestamp, sort, skip, limit} = parseStatParam(ctx);
    if(contract === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
    }

    const page = await getApiService().dailyTxnQuery.listDailyTokenAnalysis({contract, minTimestamp, maxTimestamp,
        sort, skip, limit});
    return page;
}

export async function listPowRewardStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit, } = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listPowRewardStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listPosRewardStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit, } = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listPosRewardStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listBurntFeeStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['day']);

    const {minTimestamp, maxTimestamp, sort, skip, limit, } = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listBurntFeeStat({minTimestamp,  maxTimestamp,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listBurntRateStat(ctx) {
    const {minTimestamp, maxTimestamp, sort, skip, limit} = parseStatParam(ctx);

    const page = await getApiService().dailyStatQuery.listBurntRateStat({minTimestamp, maxTimestamp,
        sort, skip, limit})
    setBody(ctx, page)
}

export function listCIP1559Stat(statType: CIP1559StatType) {
    return async (ctx) => {
        mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber', 'maxEpochNumber')

        const {minTimestamp, maxTimestamp, sort, skip, limit} = parseStatParam(ctx);
        const {minEpochNumber, maxEpochNumber} = ctx.request.query;

        const page = await getApiService().dailyBlockDataStatQuery.listCIP1559Stat({
            statType, minTimestamp, maxTimestamp, minEpochNumber, maxEpochNumber, sort, skip, limit})
        setBody(ctx, page)
    }
}
