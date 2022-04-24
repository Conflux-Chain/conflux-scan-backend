import * as Koa from 'koa'
import * as Router from "koa-router";
import {ApiServer, getApiService} from '../ApiServer'
import {StatApp} from "../../stat/StatApp";
import {registerRouter as registerRouterESpace} from "./ESpaceApiRouter";
import {addSwagger, executionTime, handleException, setBody} from "./middleware";
import {listAccountAssets} from "../service/OpenAccountService";
import {listAccountTransaction} from "../service/OpenTxService";
import {listNFTBalances, listNFTTokens, getNFTPreview} from "../service/OpenNFTService";
import {
    listAccountCfxTransfer,
    listAccountTransfer20,
    listAccountTransfer721,
    listAccountTransfer1155
} from "../service/OpenTransferService";
import {
    getPagination,
    mustBeAddressParamIfPresent,
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent,
} from "../../stat/service/common/utils";
import {address} from "js-conflux-sdk";
import {queryTokenInfo} from "../service/OpenTokenService";

const cors = require('@koa/cors');
const CONST = require('../../stat/service/common/constant');

async function root(ctx, tag) {
    ctx.body = {code: 0, message: `Conflux Scan Open Api 0.1 ${tag}`}
}

// /**
//  * Query asserts hold by one account/address.
//  * @param ctx
//  */
// async function listAccountAssets(ctx) {
//     mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'account')
//     mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
//     const {account: base32} = ctx.request.query;
//     // if (!Boolean(base32)) {
//     //     setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
//     //     return
//     // }
//     const assets = await BalanceService.listAccountBalanceInner(base32)
//     polishAssertList(assets)
//     setBody(ctx, assets)
// }

async function getTokenInfo(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
    const {contract} = ctx.request.query;

    const result = await queryTokenInfo(contract);
    setBody(ctx, result)
}

// work in progress.
async function listMiningStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day']);

    const {skip, limit, intervalType, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    if (intervalType === 'min' && limit > 60) {
        throw new Error('Parameter <limit> exceeds 60')
    }

    const page = await getApiService().dailyBlockDataStatQuery.listMiningStat({intervalType, minTimestamp,  maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit})
    setBody(ctx, page)
}
// /**
//  * query transactions of one account(address)
//  * @param ctx
//  */
// async function listAccountTransaction(ctx) {
//     mustBeIntParamIfPresent(ctx.request.query, 'minEpochNumber','maxEpochNumber', 'startBlock', 'endBlock', 'minTimestamp','maxTimestamp')
//     mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'from','to','account')
//     mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC','ASC'])
//     const {skip, limit} = skipLimit(ctx.request.query)
//     const {account: base32,minEpochNumber,maxEpochNumber,startBlock, endBlock, minTimestamp,maxTimestamp,from, to, sort, nonce, txType, needAddressInfo} = ctx.request.query;
//     if (!Boolean(base32)) {
//         setBody(ctx, ctx.request.query, CODE_PARAMETER_ABSENT, CODE_PARAMETER_ABSENT_MSG+"account")
//         return
//     }
//
//     const startEpoch = StatApp.isEVM ? startBlock : minEpochNumber;
//     const endEpoch = StatApp.isEVM ? endBlock : maxEpochNumber;
//     const page = await getApiService().fullBlockQuery.listTransaction({accountAddress: base32, skip, limit,
//         verboseAddress: false, minEpochNumber: startEpoch, maxEpochNumber: endEpoch, minTimestamp, maxTimestamp, from, to, sort, nonce, txType
//     });
//
//     const hashArray = [];
//     page?.list?.forEach(tx=>{
//         delete tx.syncTimestamp
//         delete tx.blockHash
//         if (StatApp.isEVM) {
//             tx['blockNumber'] = tx.epochNumber;
//             delete tx.epochNumber;
//             delete tx.blockPosition;
//             tx['contractAddress'] = tx.contractCreated;
//             delete tx.contractCreated;
//             tx['isError'] = tx.txExecErrorMsg ? '1' : '0';
//             hashArray.push(tx.hash);
//         }
//     })
//
//     if (StatApp.isEVM) {
//         const resp = await getApiService().fullBlockQuery.batchGetTransactionList({hashArray});
//         const {txMap} = resp;
//         page?.list?.forEach(tx=>{
//             tx['input'] = txMap[tx.hash]?.data;
//             tx['blockHash'] = txMap[tx.hash]?.blockHash;
//         })
//     }
//
//     delete page.extraInfo
//     await polishContract(page, needAddressInfo)
//     setBody(ctx, page)
// }

// async function listAccountCfxTransfer(ctx) {
//     return listTransfer(ctx, getApiService().cfxTransferQuery)
// }
// /**
//  * Query crc20 transfer of one account(address)
//  * @param ctx
//  */
// async function listAccountTransfer20(ctx) {
//     return listTransfer(ctx, getApiService().crc20transferQuery)
// }
//
// /**
//  * Query crc721 transfer of one account(address)
//  * @param ctx
//  */
// async function listAccountTransfer721(ctx) {
//     return listTransfer(ctx, getApiService().crc721transferQuery)
// }
//
// /**
//  * Query crc1155 transfer of one account(address)
//  * @param ctx
//  */
// async function listAccountTransfer1155(ctx) {
//     return listTransfer(ctx, getApiService().crc1155transferQuery)
// }

async function getSupplyStat(ctx) {
    const marketData = await getApiService().marketDataQuery.getMarketData();
    setBody(ctx, marketData);
}

async function listTpsStat(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'intervalType', ['min','hour','day']);

    const {skip, limit, intervalType, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    if (intervalType === 'min' && limit > 60) {
        throw new Error('Parameter <limit> exceeds 60')
    }

    const page = await getApiService().dailyBlockDataStatQuery.listTpsStat({intervalType, minTimestamp,  maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit})
    setBody(ctx, page)
}

async function listContractStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().contractCreateQuery.listDeployedContractStat({minTimestamp, maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit});
    setBody(ctx, page)
}

async function listCfxHolderStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().cfxHolderQuery.listCfxHolderStat({minTimestamp, maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit});
    setBody(ctx, page)
}

async function listAccountGrowthStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().cfxHolderQuery.listAccountGrowthStat({minTimestamp, maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit});
    setBody(ctx, page)
}

async function listAccountActiveStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().cfxHolderQuery.listAccountActiveStat({minTimestamp, maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit});
    setBody(ctx, page)
}

async function listTransactionStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().dailyTxnQuery.listDailyTransactionStat({minTimestamp, maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit});
    setBody(ctx, page)
}

async function listCfxTransferStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort} = parseStatParam(ctx);
    const page = await getApiService().dailyTxnQuery.listDailyCfxTransferStat({minTimestamp, maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit});
    setBody(ctx, page)
}

async function listTokenTransferStat(ctx) {
    const {skip, limit, minTimestamp, maxTimestamp, sort, contract} = parseStatParam(ctx);
    let page;
    if(!contract){
        page = await getApiService().dailyTxnQuery.listDailyTokenTransferStat({minTimestamp, maxTimestamp,
            sort:(sort || 'DESC').toLowerCase(), skip, limit});
    } else{
        page = await getApiService().dailyTxnQuery.listDailyTokenAnalysis({minTimestamp, maxTimestamp,
            sort:(sort || 'DESC').toLowerCase(), skip, limit, contract});
        page.list = page.list.map(item => ({ statTime: item.statTime, transferCount: item.transferCount,
            userCount: item.uniqueParticipantCount }));
    }
    setBody(ctx, page)
}

async function listTokenHolderStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, holderCount: item.holderCount, }));
    setBody(ctx, page)
}

async function listTokenUniqueSenderStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, uniqueSenderCount: item.uniqueSenderCount, }));
    setBody(ctx, page)
}

async function listTokenUniqueReceiverStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, uniqueReceiverCount: item.uniqueReceiverCount, }));
    setBody(ctx, page)
}

async function listTokenUniqueParticipantStat(ctx) {
    const page = await getTokenAnalysisData(ctx);
    page.list = page.list.map(item => ({ statTime: item.statTime, uniqueParticipantCount: item.uniqueParticipantCount, }));
    setBody(ctx, page)
}

async function listGasUsedTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrTransactionHandler.getStat();
    const statInfo = statObj[spanType];
    setBody(ctx, statInfo)
}

async function listMinerTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().minerBlockHandler.getStat();
    const statInfo = statObj[spanType];
    setBody(ctx, statInfo)
}

async function listCfxSenderTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrCfxTransferHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.OUT}`];
    setBody(ctx, statInfo)
}

async function listCfxReceiverTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrCfxTransferHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.IN}`];
    setBody(ctx, statInfo)
}

async function listTransactionSenderTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrTransactionHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.OUT}`];
    setBody(ctx, statInfo)
}

async function listTransactionReceiverTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().addrTransactionHandler.getStat();
    const statInfo = statObj[`${spanType}-${CONST.TX_TYPE.IN}`];
    setBody(ctx, statInfo)
}

async function listTokenTransferTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[spanType];
    setBody(ctx, statInfo)
}

async function listTokenSenderTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[`uniqueAddr-${spanType}-${CONST.TX_TYPE.OUT}`];
    setBody(ctx, statInfo)
}

async function listTokenReceiverTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[`uniqueAddr-${spanType}-${CONST.TX_TYPE.IN}`];
    setBody(ctx, statInfo)
}

async function listTokenParticipantTopStat(ctx) {
    let {spanType} = parseTopStatParam(ctx);
    const statObj = await getApiService().tokenTransferHandler.getStat();
    const statInfo = statObj[`uniqueAddr-${spanType}-${CONST.TX_TYPE.ALL}`];
    setBody(ctx, statInfo)
}

// async function listNFTBalances(ctx) {
//     mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'owner');
//     mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
//
//     const {owner} = ctx.request.query;
//     const {skip, limit} = getPagination(ctx.request.query);
//     const data = await getApiService().nftCheckerService.getNftBalancesForOpenApi({owner, skip, limit});
//
//     if (StatApp.isEVM) {
//         data?.list?.forEach(row => {
//             row.owner = row.owner ? format.hexAddress(row.owner) : row.owner;
//             row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
//         });
//     }
//
//     setBody(ctx, data)
// }
//
// async function listNFTTokens(ctx) {
//     mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'owner', 'contract');
//     mustBeIntParamIfPresent(ctx.request.query, 'skip', 'limit');
//     mustBeEnumParamIfPresent(ctx.request.query, 'detail', ['false', 'true']);
//
//     const {owner, contract, detail} = ctx.request.query;
//     if (contract === undefined) {
//         throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
//     }
//     const {skip, limit} = getPagination(ctx.request.query);
//     const data = await getApiService().nftCheckerService.getNftTokensForOpenApi({owner, contract, skip, limit});
//
//     if (StatApp.isEVM) {
//         data?.list?.forEach(row => {
//             row.contract = row.contract ? format.hexAddress(row.contract) : row.contract;
//         });
//     }
//
//     if(detail === 'true'){
//         await Promise.all(data?.list?.map(async (item) => {
//             const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: item.contract, tokenId: item.tokenId});
//             const data = {name: nftInfo?.imageName?.en, image: nftInfo?.imageUri, description: nftInfo?.imageDesc};
//             lodash.defaults(item, data);
//         }));
//     }
//
//     setBody(ctx, data)
// }
//
// async function getNFTPreview(ctx) {
//     mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
//     mustBeIntParamIfPresent(ctx.request.query, 'tokenId');
//
//     const {contract, tokenId} = ctx.request.query;
//     if(contract === undefined) {
//         throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
//     }
//     if(tokenId === undefined) {
//         throw new Error(`Invalid parameter <contract> with value [${tokenId}], tokenId is required.`)
//     }
//
//     const nftInfo = await getApiService().nftPreviewService.getNFTInfo({contractAddress: contract, tokenId});
//     if(!nftInfo) {
//         // throw new Error(`NFT not found.`)
//     }
//     const data = {contract, tokenId, name: nftInfo?.imageName?.en, image: nftInfo?.imageUri, description: nftInfo?.imageDesc};
//
//     if (StatApp.isEVM) {
//         data.contract = data.contract ? format.hexAddress(data.contract) : data.contract;
//     }
//
//     setBody(ctx, data)
// }

function parseStatParam(ctx) {
    mustBeIntParamIfPresent(ctx.request.query, 'minTimestamp', 'maxTimestamp', 'skip', 'limit');
    mustBeEnumParamIfPresent(ctx.request.query, 'sort', ['DESC', 'ASC']);
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');

    const {skip, limit} = getPagination(ctx.request.query);
    const {intervalType, minTimestamp, maxTimestamp, sort, contract} = ctx.request.query
    return {skip, limit, intervalType, minTimestamp, maxTimestamp, sort, contract};
}

function parseTopStatParam(ctx) {
    mustBeEnumParamIfPresent(ctx.request.query, 'spanType', ['24h', '3d', '7d']);

    let {spanType} = ctx.request.query
    spanType = (spanType === undefined || spanType === '24h') ? '1d' : spanType;
    return {spanType};
}

async function getTokenAnalysisData(ctx){
    const {skip, limit, minTimestamp, maxTimestamp, sort, contract} = parseStatParam(ctx);
    if(contract === undefined) {
        throw new Error(`Invalid parameter <contract> with value [${contract}], contract is required.`)
    }

    const page = await getApiService().dailyTxnQuery.listDailyTokenAnalysis({minTimestamp, maxTimestamp,
        sort:(sort || 'DESC').toLowerCase(), skip, limit, contract});
    return page;
}

export async function register(app: Koa, apiServer: ApiServer) {
    app.use(cors({'origin':'*'}))
    app.use(executionTime)
    app.use(handleException)

    const prefix = '/open';
    const swaggerYaml = StatApp.isEVM ? './document/espace-open-api.yaml' : './document/open-api.yaml';
    addSwagger(app, prefix, swaggerYaml)
    getApiService().logger.info(`url prefix: ${prefix}`)

    const router = new Router({prefix: prefix})
    let middleware = router.routes();
    app.use(middleware)

    router.get('/', async (ctx)=>{
        return root(ctx, apiServer.config.serverTag)
    })
    router.get('/favicon.ico', (ctx) => ctx.status = 204/*No Content*/);
    router.get('/version', (ctx)=>{
        ctx.body = {code: 0, message: 'ok',
            data: {
                version: '0.0.1'
            }
        }
    })

   if(!StatApp.isEVM){
       registerRouter(router);
   } else{
       registerRouterESpace(router);
   }
}

function registerRouter(router: Router) {
    // accounts
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', listAccountTransfer20)
    router.get('/account/crc721/transfers', listAccountTransfer721)
    router.get('/account/crc1155/transfers', listAccountTransfer1155)
    router.get('/account/tokens', listAccountAssets)

    // token
    router.get('/token/tokeninfo', getTokenInfo);

    // statistics
    router.get('/statistics/mining', listMiningStat)
    router.get('/statistics/supply', getSupplyStat);
    router.get('/statistics/tps', listTpsStat);
    router.get('/statistics/contract', listContractStat);
    router.get('/statistics/account/cfx/holder', listCfxHolderStat);
    router.get('/statistics/account/growth', listAccountGrowthStat);
    router.get('/statistics/account/active', listAccountActiveStat);
    router.get('/statistics/transaction', listTransactionStat);
    router.get('/statistics/cfx/transfer', listCfxTransferStat);
    router.get('/statistics/token/transfer', listTokenTransferStat);
    router.get('/statistics/top/gas/used', listGasUsedTopStat);
    router.get('/statistics/top/miner', listMinerTopStat);
    router.get('/statistics/top/transaction/sender', listTransactionSenderTopStat);
    router.get('/statistics/top/transaction/receiver', listTransactionReceiverTopStat);
    router.get('/statistics/top/cfx/sender', listCfxSenderTopStat);
    router.get('/statistics/top/cfx/receiver', listCfxReceiverTopStat);
    router.get('/statistics/top/token/transfer', listTokenTransferTopStat);
    router.get('/statistics/top/token/sender', listTokenSenderTopStat);
    router.get('/statistics/top/token/receiver', listTokenReceiverTopStat);
    router.get('/statistics/top/token/participant', listTokenParticipantTopStat);
    router.get('/statistics/token/holder', listTokenHolderStat);
    router.get('/statistics/token/unique/sender', listTokenUniqueSenderStat);
    router.get('/statistics/token/unique/receiver', listTokenUniqueReceiverStat);
    router.get('/statistics/token/unique/participant', listTokenUniqueParticipantStat);

    // nft assets
    router.get('/nft/balances', listNFTBalances);
    router.get('/nft/tokens', listNFTTokens);
    router.get('/nft/preview', getNFTPreview);
}
