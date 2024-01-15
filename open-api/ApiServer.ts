import {Conflux} from "js-conflux-sdk";
import {loadConfig, StatConfig} from "../stat/config/StatConfig";
import {initCfxSdk, initEthSdk} from "../stat/service/common/utils";
import {StatApp} from "../stat/StatApp";
import {createDB, initModel} from "../stat/service/DBProvider";
import {register} from "./router/ApiRouter";
import {FullBlockQuery} from "../stat/service/FullBlockQuery";
import {Crc20TransferQuery} from "../stat/service/Crc20TransferQuery";
import {Crc721TransferQuery} from "../stat/service/Crc721TransferQuery";
import {Crc1155TransferQuery} from "../stat/service/Crc1155TransferQuery";
import {Crc3525TransferQuery} from "../stat/service/Crc3525TransferQuery";
import {BatchBalanceWatcher} from "../stat/service/watcher/BatchBalanceWatcher";
import {ContractQuery} from "../stat/service/ContractQuery";
import {TokenQuery} from "../stat/service/TokenQuery";
import {TokenTool} from "../stat/service/tool/TokenTool";
import {CfxTransferQuery} from "../stat/service/CfxTransferQuery";
import {DailyBlockDataStatQuery} from "../stat/service/DailyBlockDataStatQuery";
import {MarketDataQuery} from "../stat/service/MarketDataQuery";
import {DailyContractCreateQuery} from "../stat/service/DailyContractCreateQuery";
import {CfxHolderQuery} from "../stat/service/CfxHolderQuery";
import {DailyTxnQuery} from "../stat/service/DailyTxnQuery";
import {RankService} from "../stat/service/RankService";
import {NFTPreviewService} from "../stat/service/nftchecker/NFTPreviewService";
import {NFTCheckerService} from "../stat/service/nftchecker/NFTCheckerService";
import {IS_EVM2, KEY_FASTEST_IPFS_GATEWAY, KV} from "../stat/model/KV";
import {Metrics} from "./common/Metrics";
import {CONST} from "../stat/service/common/constant"
import {AddrTransferQuery} from "../stat/service/AddrTransferQuery";
import {getVipInfo, initWeb3payClient, initWeb3payVipClient} from "web3pay-sdk-js/lib/rpc";
import {IPFSGatewaySync} from "../stat/service/IPFSGatewaySync";
import {ENSCheckerQuery} from "../stat/service/ens/ENSCheckerQuery";
import {AccountQuery} from "../stat/service/AccountQuery";
import {redirectLog} from "../stat/config/LoggerConfig";
import {regExitHook} from "../stat/service/tool/ProcessTool";
import {initRateLimiters} from "../stat/router/RateLimiter";
import {checkTest} from "./test/TestCase";
import {DailyNFTStatQuery} from "../stat/service/DailyNFTStatQuery";
import {DailyRewardStatQuery} from "../stat/service/DailyRewardStatQuery";
import {KEY_OPEN_API, repeatHeartBeat} from "../stat/model/HeartBeat";
import {TxnQuery} from "../stat/service/TxnQuery";
import {TxnSync} from "../stat/service/TxnSync";

const Koa = require('koa');
const app = new Koa();
const JsonRPCSDK = require('../common/JsonRPCSDK');
const {createLogger} = require('../common/utils.js');

const config = loadConfig('Prod')
let apiService: ApiService
export function getApiService() {
    return apiService
}
export class ApiService {
    contractQuery: ContractQuery
    fullBlockQuery: FullBlockQuery
    crc20transferQuery: Crc20TransferQuery
    cfxTransferQuery: CfxTransferQuery
    crc721transferQuery: Crc721TransferQuery
    crc1155transferQuery: Crc1155TransferQuery
    crc3525transferQuery: Crc3525TransferQuery
    addrTransferQuery: AddrTransferQuery
    dailyBlockDataStatQuery: DailyBlockDataStatQuery
    dailyNFTStatQuery: DailyNFTStatQuery
    dailyRewardStatQuery: DailyRewardStatQuery
    rankService: RankService;
    tokenTool: TokenTool;
    tokenQuery: TokenQuery;
    marketDataQuery: MarketDataQuery;
    contractCreateQuery: DailyContractCreateQuery;
    cfxHolderQuery: CfxHolderQuery;
    dailyTxnQuery: DailyTxnQuery;
    nftCheckerService: NFTCheckerService;
    nftPreviewService: NFTPreviewService;
    ensCheckerQuery: ENSCheckerQuery;
    accountQuery: AccountQuery;
    ipfsGatewaySync: IPFSGatewaySync;
    txnQuery: TxnQuery;
    txnSync: TxnSync;
    cfx: Conflux;
    eth;
    jsonRpc;
    logger: any
    moduleSet: Set<string>;
    actionSet: Set<string>;
    metrics: Metrics;
}


export class ApiServer {
    config: StatConfig
    cfx: Conflux;
    eth;

    constructor() {
        this.config = config
    }

    public async init() {
        let logger = createLogger('apiServer', 'open-api', './log/open-api', 'info');
        logger.info(`-------- start api server, port ${config.apiPort}--------`)

        this.cfx = await initCfxSdk(config.conflux);
        this.eth = initEthSdk(config.ether.url)
        StatApp.networkId = this.cfx.networkId;

        StatApp.readonly = config.database.readonly
        const sequelize = createDB(config.databaseRW)
        await initModel(sequelize)
        await sequelize.sync({})

        await initRateLimiters(config.redis);

        StatApp.isEVM = await KV.getSwitch(IS_EVM2);
        apiService = new ApiService()
        const apiApp = {networkId: this.cfx.networkId, cfx: this.cfx, service: apiService, config: this.config};
        apiService.fullBlockQuery = new FullBlockQuery(apiApp)
        apiService.crc20transferQuery = new Crc20TransferQuery(apiApp)
        apiService.cfxTransferQuery = new CfxTransferQuery(apiApp)
        apiService.crc721transferQuery = new Crc721TransferQuery(apiApp)
        apiService.crc1155transferQuery = new Crc1155TransferQuery(apiApp)
        apiService.crc3525transferQuery = new Crc3525TransferQuery(apiApp)
        apiService.addrTransferQuery = new AddrTransferQuery(apiApp)
        apiService.dailyBlockDataStatQuery = new DailyBlockDataStatQuery(apiApp)
        apiService.dailyNFTStatQuery = new DailyNFTStatQuery(apiApp)
        apiService.dailyRewardStatQuery = new DailyRewardStatQuery(apiApp)
        apiService.rankService = new RankService(apiApp)
        apiService.marketDataQuery = new MarketDataQuery(apiApp);
        apiService.contractCreateQuery = new DailyContractCreateQuery();
        apiService.cfxHolderQuery = new CfxHolderQuery();
        apiService.dailyTxnQuery = new DailyTxnQuery();
        apiService.nftCheckerService = new NFTCheckerService(apiApp);
        apiService.nftPreviewService = new NFTPreviewService(apiApp);
        apiService.ensCheckerQuery = new ENSCheckerQuery(apiApp);
        const accountQuery = new AccountQuery(apiApp);
        apiService.accountQuery = accountQuery;
        const tokenTool = new TokenTool(this.cfx)
        apiService.tokenTool = tokenTool
        apiService.tokenQuery = new TokenQuery({tokenTool, config: this.config})
        apiService.jsonRpc = new JsonRPCSDK(config.jsonRpc);
        apiService.contractQuery = new ContractQuery({cfx: this.cfx, config: this.config, jsonRpc: apiService.jsonRpc,
            tokenQuery: apiService.tokenQuery, tokenTool})
        apiService.ipfsGatewaySync = new IPFSGatewaySync(apiApp);
        apiService.txnQuery = new TxnQuery()
        apiService.txnSync = new TxnSync({cfx: this.cfx, accountQuery})
        apiService.cfx = this.cfx;
        apiService.eth = this.eth;
        apiService.logger = logger;
        await this.initModule();
        await this.initMetrics(apiService);

        let utilContract = await BatchBalanceWatcher.getUtilContractAddr();
        console.log(` util contract ${utilContract}`)
        new BatchBalanceWatcher(this.cfx, null, utilContract)
        await apiService.marketDataQuery.scheduleCache();
        await apiService.txnQuery.scheduleCache()
        config.asyncVerifySourcecode && (await apiService.contractQuery.schedule());
        config.asyncWrappedToken && (await apiService.tokenQuery.scheduleWrappedCFX());
        if(config.syncIPFSGateway) {
            IPFSGatewaySync.fastest = await KV.getString(KEY_FASTEST_IPFS_GATEWAY, '');
            await apiService.ipfsGatewaySync.schedule(config.syncIPFSGatewayDelay);
        }
    }

    private initModule(){
        apiService.moduleSet = new Set<string>();
        apiService.actionSet = new Set<string>();
        Object.values(CONST.E_SPACE_OPENAPI).forEach(item => {
            apiService.moduleSet.add(item['module'])
            Object.values(item['action']).forEach(action => apiService.actionSet.add(action as string));
        });
    }

    private async initMetrics(apiService: ApiService){
        apiService.metrics = new Metrics(config);
        await apiService.metrics.init();
    }
}
async function initBilling(config: StatConfig) {
    const url = config.billingUrl;
    const key = config.billingKey;
    const billingApp = config.billingApp;
    if (!url || !key) {
        console.log(`billing url or key not set [${url}] [${key}]`)
        return
    }
    const keyJsonStr = Buffer.from(key, 'base64').toString()
    console.log(`key json str`, keyJsonStr)
    initWeb3payClient(url, key, 1_000)
    await initWeb3payVipClient(config.ether.url, billingApp,);
    console.log(`using billing ${url}, now test...`)
    try {
        const result = await getVipInfo(billingApp)
        console.log(`get vip info test:`, result);
    } catch (e) {
        console.log(`test web3pay fail:`, e)
    }
}
export function initApiServer() {
    regExitHook();
    if (__filename.startsWith('/scan/')) {
        redirectLog({mainPath:'OpenApi'})
    }
    const apiServer = new ApiServer();
    const port = process.env.API_PORT || apiServer.config.apiPort || 9527;
    apiServer.init().then(()=>{
        return register(app, apiServer, port)
    }).then(()=>{
        return initBilling(apiServer.config)
    }).then(()=>{
        return checkTest();
    }).then(()=>{
        repeatHeartBeat(KEY_OPEN_API+apiServer.config.serverTag+port)
        app.listen(port)
        console.log(`api server listen at ${port}`)
    })
}

if (module === require.main) {
    initApiServer()
}
