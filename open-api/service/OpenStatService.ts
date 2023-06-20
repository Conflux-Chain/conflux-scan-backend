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

export async function listMiningStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day']);

    const {skip, limit, intervalType, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    if (intervalType === 'min' && limit > 60) {
        throw new Error('Parameter <limit> exceeds 60')
    }

    const page = await getApiService().dailyBlockDataStatQuery.listMiningStat({intervalType, minTimestamp,  maxTimestamp,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTAssetStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit, } = parseStatParam(ctx);

    const page = await getApiService().dailyNFTStatQuery.listNFTAssetStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTContractStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit} = parseStatParam(ctx);

    const page = await getApiService().dailyNFTStatQuery.listNFTContractStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTTransferStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit} = parseStatParam(ctx);

    const page = await getApiService().dailyNFTStatQuery.listNFTTransferStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listNFTHolderStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['day','month']);
    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit} = parseStatParam(ctx);

    const page = await getApiService().dailyNFTStatQuery.listNFTHolderStat({minTimestamp,  maxTimestamp, intervalType,
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
    if (intervalType === 'min' && limit > 60) {
        throw new Error('Parameter <limit> exceeds 60')
    }

    const page = await getApiService().dailyBlockDataStatQuery.listTpsStat({intervalType, minTimestamp,  maxTimestamp,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listContractStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().contractCreateQuery.listDeployedContractStat({minTimestamp, maxTimestamp,
        sort, skip, limit});
    setBody(ctx, page)
}

export async function listApproval(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM, 'account');
    mustBeEnumParamIfPresent(ctx.request.query, 'tokenType',
        ['ERC20','ERC721','ERC1155']);
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
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrTransactionHandler.getStat();
    const statInfo = statObj[spanType];
    setBody(ctx, statInfo)
}

export async function listMinerTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().minerBlockHandler.getStat();
    const statInfo = statObj[spanType];
    setBody(ctx, statInfo)
}

export async function listCfxSenderTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrCfxTransferHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.OUT}`];
    setBody(ctx, statInfo)
}

export async function listCfxReceiverTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrCfxTransferHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.IN}`];
    setBody(ctx, statInfo)
}

export async function listTransactionSenderTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrTransactionHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.OUT}`];
    setBody(ctx, statInfo)
}

export async function listTransactionReceiverTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrTransactionHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.IN}`];
    setBody(ctx, statInfo)
}

export async function listTokenTransferTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[spanType];
    setBody(ctx, statInfo)
}

export async function listTokenSenderTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[`uniqueAddr-${spanType}-${CONST.TX_TYPE.OUT}`];
    setBody(ctx, statInfo)
}

export async function listTokenReceiverTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[`uniqueAddr-${spanType}-${CONST.TX_TYPE.IN}`];
    setBody(ctx, statInfo)
}

export async function listTokenParticipantTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[`uniqueAddr-${spanType}-${CONST.TX_TYPE.ALL}`];
    setBody(ctx, statInfo)
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

    let {spanType} = ctx.request.query
    spanType = (spanType === undefined || spanType === '24h') ? '1d' : spanType;
    return {spanType};
}

async function getTokenAnalysisData(ctx){
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

    const page = await getApiService().dailyRewardStatQuery.listPowRewardStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}

export async function listPosRewardStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['hour','day','month']);

    const {minTimestamp, maxTimestamp, intervalType, sort, skip, limit, } = parseStatParam(ctx);

    const page = await getApiService().dailyRewardStatQuery.listPosRewardStat({minTimestamp,  maxTimestamp, intervalType,
        sort, skip, limit})
    setBody(ctx, page)
}