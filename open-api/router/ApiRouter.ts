import * as Koa from 'koa'
import * as Router from "koa-router";
import bodyParser = require("koa-bodyparser");
import {ApiServer, getApiService} from '../ApiServer'
import {StatApp} from "../../stat/StatApp";
import {registerRouter as registerRouterESpace} from "./ESpaceApiRouter";
import {addSwagger, executionTime, handleException, setBody} from "./middleware";
import {
    listAccountAssets
} from "../service/OpenAccountService";
import {
    abiDecode, abiDecodeRaw,
    listAccountTransaction
} from "../service/OpenTxService";
import {
    listAccountCfxTransfer,
    listAccountTransfer20,
    listAccountTransfer721,
    listAccountTransfer1155,
    listAccountTransfer
} from "../service/OpenTransferService";
import {
    checkProxyVerification,
    checkVerifyStatus,
    getABI,
    getSourceCode, verifyProxyContract,
    verifySourcecode
} from "../service/OpenContractService";
import {
    queryTokenInfo
} from "../service/OpenTokenService";
import {
    listNFTBalances,
    listNFTTokens,
    getNFTPreview,
} from "../service/OpenNFTService";
import {
    listMiningStat,
    getSupplyStat,
    listTpsStat,
    listContractStat,
    listCfxHolderStat,
    listAccountGrowthStat,
    listAccountActiveStat,
    listTransactionStat,
    listCfxTransferStat,
    listTokenTransferStat,
    listGasUsedTopStat,
    listMinerTopStat,
    listTransactionSenderTopStat,
    listTransactionReceiverTopStat,
    listCfxSenderTopStat,
    listCfxReceiverTopStat,
    listTokenTransferTopStat,
    listTokenSenderTopStat,
    listTokenReceiverTopStat,
    listTokenParticipantTopStat,
    listTokenHolderStat,
    listTokenUniqueSenderStat,
    listTokenUniqueReceiverStat,
    listTokenUniqueParticipantStat,
} from "../service/OpenStatService";
import {
    mustBeAddressParamIfPresent,
} from "../../stat/service/common/utils";
import {buildCheckAddressRateFn, checkApiKey, checkRate, loadRateConfig} from "../../stat/router/RateLimiter";

const cors = require('@koa/cors');

async function root(ctx, tag) {
    ctx.body = {code: 0, message: `Conflux Scan Open Api 0.1 ${tag}`}
}

async function getTokenInfo(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
    const {contract} = ctx.request.query;

    const result = await queryTokenInfo(contract);
    setBody(ctx, result)
}

export async function register(app: Koa, apiServer: ApiServer) {
    app.use(cors({'origin':'*'}))
    loadRateConfig().then()
    app.use(checkRate)
    app.use(bodyParser({
        formLimit: '10mb',
    }))
    app.use(executionTime)
    app.use(handleException)

    const prefix = '/open';
    const swaggerYaml = StatApp.isEVM ? './document/espace-open-api.yaml' : './document/open-api.yaml';
    addSwagger(app, prefix, swaggerYaml)
    getApiService().logger.info(`url prefix: ${prefix}`)

    const router = new Router({prefix: prefix})
    let middleware = router.routes();
    app.use(middleware)

    app.proxy = true
    router.get('/', async (ctx)=>{
        return root(ctx, apiServer.config.serverTag)
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
    const checkAddressRateFn = buildCheckAddressRateFn('contract', true)
    // accounts
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', checkAddressRateFn, listAccountTransfer20)
    router.get('/account/crc721/transfers', checkAddressRateFn, listAccountTransfer721)
    router.get('/account/crc1155/transfers', checkAddressRateFn, listAccountTransfer1155)
    router.get('/account/transfers', checkAddressRateFn, listAccountTransfer)
    router.get('/account/tokens', listAccountAssets)

    // contract
    router.get('/contract/getabi', getABI)
    router.get('/contract/getsourcecode', getSourceCode)
    router.post('/contract/verifysourcecode', verifySourcecode)
    router.get('/contract/checkverifystatus', checkVerifyStatus)
    router.get('/contract/verifyproxycontract', verifyProxyContract)
    router.get('/contract/checkproxyverification', checkProxyVerification)

    // token
    router.get('/token/tokeninfo', getTokenInfo);

    // nft assets
    router.get('/nft/balances', listNFTBalances);
    router.get('/nft/tokens', checkAddressRateFn, listNFTTokens);
    router.get('/nft/preview', getNFTPreview);

    // utils
    router.get('/util/decode/method', abiDecode);
    router.get('/util/decode/method/raw', abiDecodeRaw);

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
}
