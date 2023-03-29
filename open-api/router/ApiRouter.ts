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
    abiDecode,
    abiDecodeRaw,
    listAccountTransaction
} from "../service/OpenTxService";
import {
    listAccountCfxTransfer,
    listAccountTransfer20,
    listAccountTransfer721,
    listAccountTransfer1155,
    listAccountTransfer3525,
    listAccountTransfer,
    listNFTTransfers
} from "../service/OpenTransferService";
import {
    checkProxyVerification,
    checkVerifyStatus,
    getABI,
    getSourceCode,
    verifyProxyContract,
    verifySourcecode
} from "../service/OpenContractService";
import {
    queryTokenInfo
} from "../service/OpenTokenService";
import {
    listNFTBalances,
    listNFTTokensByFts,
    getNFTPreview,
    listNFTOwners,
    listNFTTokens,
    listNFTTokensNew,
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
    listApproval,
    listNFTAssetStat,
    listNFTContractStat,
    listNFTTransferStat,
    listNFTHolderStat,
} from "../service/OpenStatService";
import {
    mustBeAddressParamIfPresent,
} from "../../stat/service/common/utils";
import {
    checkApiKey,
    checkRateByLevel,
    checkRateByAddress,
    loadRateConfig,
    loadRateKeyConfig
} from "../../stat/router/RateLimiter";

const path = require('path');
const cors = require('@koa/cors');

async function root(ctx, tag, port: string | number) {
    ctx.body = {code: 0, app:'Conflux Scan Open Api', message: `${tag} ${port}`}
}

async function getTokenInfo(ctx) {
    mustBeAddressParamIfPresent(ctx.request.query, StatApp.networkId, 'contract');
    const {contract} = ctx.request.query;

    const result = await queryTokenInfo(contract);
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
    const yaml = path.resolve(__dirname, '../../document/', StatApp.isEVM ? 'espace-open-api.yaml' : 'open-api.yaml');
    const tld = apiServer.config.tldOpenapi
    addSwagger(app, prefix, yaml, tld)
    getApiService().logger.info(`url prefix: ${prefix}`)

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
    // accounts
    router.get('/account/transactions', listAccountTransaction)
    router.get('/account/cfx/transfers', listAccountCfxTransfer)
    router.get('/account/crc20/transfers', checkRateByAddr, listAccountTransfer20)
    router.get('/account/crc721/transfers', checkRateByAddr, listAccountTransfer721)
    router.get('/account/crc1155/transfers', checkRateByAddr, listAccountTransfer1155)
    router.get('/account/crc3525/transfers', checkRateByAddr, listAccountTransfer3525)
    router.get('/account/transfers', checkRateByAddr, listAccountTransfer)
    router.get('/account/approvals', checkRateByAddr, listApproval)
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
    router.get('/nft/tokens', checkRateByAddr, listNFTTokensNew);
    router.get('/nft/preview', getNFTPreview);
    router.get('/nft/fts', listNFTTokensByFts);
    router.get('/nft/owners', listNFTOwners);
    router.get('/nft/transfers', listNFTTransfers);

    // utils
    router.get('/util/decode/method', abiDecode);
    router.get('/util/decode/method/raw', abiDecodeRaw);

    // statistics
    router.get('/statistics/supply', getSupplyStat);
    router.get('/statistics/mining', listMiningStat)
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
    router.get('/statistics/nft/asset', listNFTAssetStat);
    router.get('/statistics/nft/contract', listNFTContractStat);
    router.get('/statistics/nft/transfer', listNFTTransferStat);
    router.get('/statistics/nft/holder', listNFTHolderStat);
}
