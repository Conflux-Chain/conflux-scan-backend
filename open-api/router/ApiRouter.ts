import * as Koa from 'koa'
import * as Router from "koa-router";
import * as bodyParser from "koa-bodyparser";
import {ApiServer, getApiService} from '../ApiServer'
import {StatApp} from "../../stat/StatApp";
import {registerRouter as registerRouterESpace} from "./ESpaceApiRouter";
import {addSwagger, executionTime, handleException, setBody} from "./middleware";
import {listAccountAssets} from "../service/OpenAccountService";
import {abiDecode, abiDecodeRaw, listAccountTransaction} from "../service/OpenTxService";
import {
    listAccountCfxTransfer,
    listAccountTransfer,
    listAccountTransfer1155,
    listAccountTransfer20,
    listAccountTransfer3525,
    listAccountTransfer721,
    listNFTTransfers
} from "../service/OpenTransferService";
import {
    checkProxyVerification,
    checkVerifyStatus,
    getABI,
    getContractCreation,
    getSourceCode,
    verifyProxyContract,
    verifySourcecode
} from "../service/OpenContractService";
import {
    getToken,
    listTokens,
} from "../service/OpenTokenService";
import {
    getNFTPreview,
    listAccountNFTs,
    listNFTOwners,
    listNFTTokensByFts,
    listNFTTokensPro,
} from "../service/OpenNFTService";
import {
    getSupplyStat,
    listAccountActiveStats,
    listAccountGrowthStats,
    listApproval,
    listBurntFeeStats,
    listBurntRateStats,
    listCfxHolderStats,
    listCfxReceiverTopStat,
    listCfxSenderTopStat,
    listCfxTransferStat,
    listCIP1559Stats,
    listContractStats,
    listGasUsedTopStat,
    listMinerTopStat,
    listCoreMiningStat,
    listNFTAssetStats,
    listNFTContractStats,
    listNFTHolderStats,
    listNFTTransferStats,
    listPosRewardStats,
    listPowRewardStats,
    listTokenHolderStat,
    listTokenParticipantTopStat,
    listTokenReceiverTopStat,
    listTokenSenderTopStat,
    listTokenTransferStat,
    listTokenTransferTopStat,
    listTokenUniqueParticipantStat,
    listTokenUniqueReceiverStat,
    listTokenUniqueSenderStat,
    listTpsStats,
    listTransactionReceiverTopStat,
    listTransactionSenderStat,
    listTransactionSenderTopStat,
    listCoreTransactionStat,
} from "../service/OpenStatService";
import {mustBeAddressParamIfPresent,} from "../../stat/service/common/utils";
import {
    checkApiKey,
    checkRateByAddress,
    checkRateByLevel,
    loadRateConfig,
    loadRateKeyConfig
} from "../../stat/router/RateLimiter";
import {CIP1559StatType} from "../../stat/service/StatsQuery";
import {NoCoreSpace} from "../../stat/config/StatConfig";
import {listAccountsByCursor} from "../service/OpenDataService";

const path = require('path');
const cors = require('@koa/cors');

async function root(ctx, tag, port: string | number) {
    ctx.body = {code: 0, app:'Scan Open Api', message: `${tag} ${port}`}
}

async function getTokenInfo(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, StatApp.isEVM,'contract');
    const {contract} = ctx.request.query;

    const result = await getToken(contract);
    setBody(ctx, result)
}

export async function register(app: Koa, apiServer: ApiServer, port:string|number) {
    app.use(cors({'origin':'*'}))
    await loadRateConfig()
    await loadRateKeyConfig()
    app.use(checkRateByLevel)
    app.use(bodyParser({
        formLimit: '10mb',
    }))
    app.use(executionTime)
    app.use(handleException)

    const prefix = '/open';
    const yaml = path.resolve(__dirname, '../../document/', NoCoreSpace ? 'evm-open-api.yaml' : StatApp.isEVM ? 'espace-open-api.yaml' : 'open-api.yaml');
    const tld = apiServer.config.tldOpenapi
    addSwagger(app, prefix, yaml, tld)
    console.log(`url prefix: ${prefix}`)

    const router = new Router({prefix: prefix})
    let middleware = router.routes();
    app.use(middleware)

    app.proxy = true
    router.get('/', async (ctx)=>{
        return root(ctx, apiServer.config.serverTag, port)
    })
    router.get('/echo', (ctx)=>{
        ctx.body = {ip: ctx.ip, header: ctx.headers}
    })
    router.get('/test-billing', async (ctx)=>{
        const {ok:paid, result: billingResult} =
            await checkApiKey('/test-billing', ctx?.request?.query?.apiKey || ctx?.headers['apiKey'],
                ctx.request.query.dryRun
            )
        ctx.body = {paid, billingResult, query: ctx.request.query, header: ctx.headers, ip: ctx.ip}
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
    const checkRateByAddr = checkRateByAddress('contract');
    const checkRateByAccount = checkRateByAddress('account');
    // accounts
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', checkRateByAddr, listAccountTransfer20)
    router.get('/account/crc721/transfers', checkRateByAddr, listAccountTransfer721)
    router.get('/account/crc1155/transfers', checkRateByAddr, listAccountTransfer1155)
    router.get('/account/crc3525/transfers', checkRateByAddr, listAccountTransfer3525)
    router.get('/account/transfers', checkRateByAddr, listAccountTransfer)
    router.get('/account/approvals', checkRateByAddr, listApproval)
    router.get('/account/tokens', checkRateByAccount, listAccountAssets)

    // contract
    router.get('/contract/getabi', getABI)
    router.get('/contract/getsourcecode', getSourceCode)
    router.get('/contract/getContractCreation', getContractCreation)
    router.post('/contract/verifysourcecode', verifySourcecode)
    router.get('/contract/checkverifystatus', checkVerifyStatus)
    router.get('/contract/verifyproxycontract', verifyProxyContract)
    router.get('/contract/checkproxyverification', checkProxyVerification)

    // token
    router.get('/token/tokeninfo', getTokenInfo);
    router.get('/token/tokeninfos', listTokens);

    // nft assets
    router.get('/nft/balances', listAccountNFTs);
    router.get('/nft/tokens', checkRateByAddr, listNFTTokensPro);
    router.get('/nft/preview', getNFTPreview);
    router.get('/nft/fts', listNFTTokensByFts);
    router.get('/nft/owners', listNFTOwners);
    router.get('/nft/transfers', listNFTTransfers);

    // utils
    router.get('/util/decode/method', abiDecode);
    router.get('/util/decode/method/raw', abiDecodeRaw);

    // statistics
    router.get('/statistics/supply', getSupplyStat);
    router.get('/statistics/mining', listCoreMiningStat)
    router.get('/statistics/tps', listTpsStats);
    router.get('/statistics/contract', listContractStats);
    router.get('/statistics/account/cfx/holder', listCfxHolderStats);
    router.get('/statistics/account/growth', listAccountGrowthStats);
    router.get('/statistics/account/active', listTransactionSenderStat);
    router.get('/statistics/account/active/overall', listAccountActiveStats);
    router.get('/statistics/transaction', listCoreTransactionStat);
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
    router.get('/statistics/nft/asset', listNFTAssetStats);
    router.get('/statistics/nft/contract', listNFTContractStats);
    router.get('/statistics/nft/transfer', listNFTTransferStats);
    router.get('/statistics/nft/holder', listNFTHolderStats);
    router.get('/statistics/reward/pow', listPowRewardStats);
    router.get('/statistics/reward/pos', listPosRewardStats);

    router.get('/statistics/burnt/fee', listBurntFeeStats);
    router.get('/statistics/burnt/rate', listBurntRateStats);
    router.get('/statistics/block/base-fee', listCIP1559Stats(CIP1559StatType.BASE_FEE));
    router.get('/statistics/block/avg-priority-fee', listCIP1559Stats(CIP1559StatType.PRIORITY_FEE));
    router.get('/statistics/block/gas-used', listCIP1559Stats(CIP1559StatType.GAS_USED));
    router.get('/statistics/block/txs-by-type', listCIP1559Stats(CIP1559StatType.TXS_BY_TYPE));

    registerDataApi(router)
}

export function registerDataApi(router: Router) {
    router.get('/data/accounts', listAccountsByCursor)
}
