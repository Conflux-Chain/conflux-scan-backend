import {StatApp} from "../../stat/StatApp";
import {
    checkPresent,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent
} from "../../stat/service/common/utils";
import {setBody} from "../router/middleware";
import {getApiService} from "../ApiServer";
import {ApprovalRelation} from "../../stat/ApprovalSync";
import {paginateCoreStat} from "../../stat/router/ParamChecker";
import {polishContract} from "./OpenContractService";
import {fixApprovalData} from "../../stat/service/tool/ApprovalTool";
import {BlockAndMinerSync} from "../../stat/service/BlockAndMinerSync";
import {CIP1559StatType} from "../../stat/service/StatsQuery";

export async function listCoreMiningStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day']);
    const page = await getApiService().statsQuery.listBlockDataStats({
        ...parseStatParam(ctx), attributes: ['statTime', 'blockTime', ['hashrate', 'hashRate'], 'difficulty']});
    setBody(ctx, page);
}

export async function listNFTAssetStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);
    const page = await getApiService().statsQuery.listNFTAssetStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listNFTContractStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);
    const page = await getApiService().statsQuery.listNFTContractStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listNFTTransferStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);
    const page = await getApiService().statsQuery.listNFTTransferStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listNFTHolderStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['day','month']);
    const page = await getApiService().statsQuery.listNFTHolderStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function getSupplyStat(ctx) {
    const marketData = await getApiService().marketDataQuery.getMarketData();
    setBody(ctx, marketData);
}

export async function listTpsStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day']);
    const page = await getApiService().statsQuery.listBlockDataStats({
        ...parseStatParam(ctx), attributes: ['statTime', 'tps'],
    });
    setBody(ctx, page);
}

export async function listContractStats(ctx) {
    const page = await getApiService().statsQuery.listContractCreationStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listApproval(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'account');
    mustBeEnumParamIfPresent(ctx.request.query, 'tokenType', ['ERC20','ERC721','ERC1155', 'CRC20','CRC721','CRC1155']);
    mustBeEnumParamIfPresent(ctx.request.query, 'byTokenId',
        ['false','true']);
    const {account, tokenType, byTokenId} = ctx.request.query;
    checkPresent({account, tokenType}, ['account']);
    const data = await ApprovalRelation.queryApprovalOfAccount({account, tokenType,
        byTokenId: byTokenId === 'true', cfx:getApiService().cfx});
    await polishContract(data);
    await fixApprovalData(data);
    setBody(ctx, data);
}

export async function listCfxHolderStats(ctx) {
    const page = await getApiService().statsQuery.listCfxHolderStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listAccountGrowthStats(ctx) {
    const page = await getApiService().statsQuery.listAccountGrowthStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listAccountActiveStats(ctx) {
    const page = await getApiService().statsQuery.listAccountActiveStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listCoreTransactionStat(ctx) {
    const page = await getApiService().statsQuery.listDailyTransactionStats({
        ...(parseStatParam(ctx)), attributes: [['statDay', 'statTime'], ['txCount', 'count']],
    });
    setBody(ctx, page);
}

export async function listTransactionSenderStat(ctx) {
    const page = await getApiService().statsQuery.listDailyTransactionStats({
        ...parseStatParam(ctx), attributes: [['statDay', 'statTime'], ['senderCount', 'count']],
    });
    setBody(ctx, page);
}

export async function listCfxTransferStat(ctx) {
    const page = await getApiService().statsQuery.listDailyCfxTransferStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listTokenTransferStat(ctx) {
    const params = parseStatParam(ctx);
    let page;
    if(!params?.contract){
        page = await getApiService().statsQuery.listDailyTokenTransferStats(params);
    } else{
        page = await getApiService().statsQuery.listDailyTokenAnalysis(params);
        page.list = page.list.map(item => ({
            statTime: item.statTime,
            transferCount: item.transferCount,
            userCount: item.uniqueParticipantCount,
        }));
    }
    setBody(ctx, page);
}

export async function listTokenHolderStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({
        statTime: item.statTime,
        holderCount: item.holderCount,
    }));
    setBody(ctx, page);
}

export async function listTokenUniqueSenderStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({
        statTime: item.statTime,
        uniqueSenderCount: item.uniqueSenderCount,
    }));
    setBody(ctx, page);
}

export async function listTokenUniqueReceiverStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({
        statTime: item.statTime,
        uniqueReceiverCount: item.uniqueReceiverCount,
    }));
    setBody(ctx, page);
}

export async function listTokenUniqueParticipantStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({
        statTime: item.statTime,
        uniqueParticipantCount: item.uniqueParticipantCount,
    }));
    setBody(ctx, page);
}

export async function listGasUsedTopStat(ctx) {
    const {span, type} = parseTopStatParam(ctx);
    const cache = getApiService().txnQuery.topGasUsedCache[`${span}${type}`];
    const data = {
        gasTotal: cache['totalGas'],
        maxTime: cache['cacheCreatedAt'],
        list: cache?.list.map(item => ({
            address: StatApp.isEVM ? item['hex'] : item['base32'],
            gas: item['gas'],
        }))
    }
    setBody(ctx, data);
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
    setBody(ctx, data);
}

export async function listCfxSenderTopStat(ctx) {
    await topCfxTransfer(ctx, 'cfxSend');
}

export async function listCfxReceiverTopStat(ctx) {
    await topCfxTransfer(ctx, 'cfxReceived');
}

export async function listTransactionSenderTopStat(ctx) {
    await topCfxTransfer(ctx, 'txnSend');
}

export async function listTransactionReceiverTopStat(ctx) {
    await topCfxTransfer(ctx, 'txnReceived');
}

async function topCfxTransfer(ctx, statType) {
    const { span, type } = parseTopStatParam(ctx);
    const cache: any = await getApiService().txnSync.txTopBy(span, type, 10, statType, StatApp.networkId);
    const data = {
        maxTime: cache['endTime'],
        valueTotal: cache['sum'],
        list: cache?.list.map(item => ({
            address: StatApp.isEVM ? item['hex'] : item['base32'],
            value: item['value'],
        })),
    }
    setBody(ctx, data);
}

export async function listTokenTransferTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_transfers_');
}

export async function listTokenSenderTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_senders_');
}

export async function listTokenReceiverTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_receivers_');
}

export async function listTokenParticipantTopStat(ctx) {
    await topTokenTransfer(ctx, 'rank_contract_by_number_of_participants_');
}

async function topTokenTransfer(ctx, statType) {
    const { span, type } = parseTopStatParam(ctx);
    const spanType = (span === 24 && type === 'h') ? '1d' : `${span}${type}`;
    const topType = `${statType}${spanType}`;
    const cache: any = await getApiService().rankService.top(topType, 10, StatApp.networkId);
    const data = {
        maxTime: cache['maxTimeStart'],
        list: cache?.list.map(item => ({
            address: StatApp.isEVM ? item['hex'] : item['base32address'],
            transferCntr: item['valueN'],
        })),
    }
    setBody(ctx, data);
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
    const {spanType = '24h'} = ctx.request.query;
    let span, type;
    if(spanType.endsWith('h')) {
        type = 'h';
        span = 24;
    } else{
        type = 'd';
        span = Number(spanType.substring(0, 1));
    }
    return {span, type};
}

async function getTokenAnalysisData(ctx){
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'contract');
    return getApiService().statsQuery.listDailyTokenAnalysis(parseStatParam(ctx));
}

export async function listPowRewardStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);
    const page = await getApiService().statsQuery.listPowRewardStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listPosRewardStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);
    const page = await getApiService().statsQuery.listPosRewardStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listBurntFeeStats(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['day']);
    const page = await getApiService().statsQuery.listBurntFeeStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export async function listBurntRateStats(ctx) {
    const page = await getApiService().statsQuery.listBurntRateStats(parseStatParam(ctx));
    setBody(ctx, page);
}

export function listCIP1559Stats(statType: CIP1559StatType) {
    return async (ctx) => {
        mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber', 'maxEpochNumber');
        const {minEpochNumber, maxEpochNumber} = ctx.request.query;

        const page = await getApiService().statsQuery.listCIP1559Stats({
            ...(parseStatParam(ctx)), statType, minEpochNumber, maxEpochNumber,
        });
        setBody(ctx, page);
    }
}
