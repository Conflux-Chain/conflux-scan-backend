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
import {HomepageDashboard} from "../stat/service/HomepageDashboard";
import {RankService} from "../stat/service/RankService";
import {NFTPreviewService} from "../stat/service/nftchecker/NFTPreviewService";
import {NFTCheckerService} from "../stat/service/nftchecker/NFTCheckerService";
import {IS_EVM2, KEY_FASTEST_IPFS_GATEWAY, KV} from "../stat/model/KV";
import {Metrics} from "./common/Metrics";
import {CONST} from "../stat/service/common/constant"
import {AccountTransferQuery} from "../stat/service/AccountTransferQuery";
import {getVipInfo, initWeb3payVipClient} from "web3pay-sdk-js/lib/rpc";
import {IPFSGatewaySync} from "../stat/service/IPFSGatewaySync";
import {ENSCheckerQuery} from "../stat/service/ens/ENSCheckerQuery";
import {AccountQuery} from "../stat/service/AccountQuery";
import {redirectLog} from "../stat/config/LoggerConfig";
import {regExitHook} from "../stat/service/tool/ProcessTool";
import {initRateLimiters} from "../stat/router/RateLimiter";
import {checkTest} from "./test/TestCase";
import {StatsQuery} from "../stat/service/StatsQuery";
import {KEY_OPEN_API, repeatHeartBeat} from "../stat/model/HeartBeat";
import {TxnQuery} from "../stat/service/TxnQuery";
import {TxnSync} from "../stat/service/TxnSync";
import {scheduleSwaggerReporter} from "../stat/monitor/swaggerMetrics";
import {ContractTraceCreateQuery} from "../stat/service/ContractTraceCreateQuery";
import {BalanceService} from "../stat/service/watcher/BalanceService";

const Koa = require('koa');
const app = new Koa();
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
    accountTransferQuery: AccountTransferQuery
    statsQuery: StatsQuery
    rankService: RankService;
    tokenTool: TokenTool;
    tokenQuery: TokenQuery;
    homepageDashboard: HomepageDashboard;
    nftCheckerService: NFTCheckerService;
    nftPreviewService: NFTPreviewService;
    ensCheckerQuery: ENSCheckerQuery;
    accountQuery: AccountQuery;
    ipfsGatewaySync: IPFSGatewaySync;
    txnQuery: TxnQuery;
    txnSync: TxnSync;
    traceCreateQuery: ContractTraceCreateQuery;
    balanceService: BalanceService;
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
        console.log(`-------- start api server, port ${config.apiPort} --------`)

        this.cfx = await initCfxSdk(config.conflux);
        this.eth = initEthSdk(config.ether?.url)
        StatApp.networkId = this.cfx.networkId;

        StatApp.readonly = config.database.readonly
        const sequelize = createDB(config.databaseRW)
        await initModel(sequelize)
        await sequelize.sync({})

        await initRateLimiters();

        StatApp.isEVM = await KV.getSwitch(IS_EVM2);
        if (StatApp.isEVM) {
            // evm open api will access wrapped cfx in token list
            this.config.asyncWrappedToken = true
        }
        apiService = new ApiService()
        const apiApp = {networkId: this.cfx.networkId, cfx: this.cfx, service: apiService, config: this.config};
        apiService.fullBlockQuery = new FullBlockQuery(apiApp)
        apiService.crc20transferQuery = new Crc20TransferQuery(apiApp)
        apiService.cfxTransferQuery = new CfxTransferQuery(apiApp)
        apiService.crc721transferQuery = new Crc721TransferQuery(apiApp)
        apiService.crc1155transferQuery = new Crc1155TransferQuery(apiApp)
        apiService.crc3525transferQuery = new Crc3525TransferQuery(apiApp)
        apiService.accountTransferQuery = new AccountTransferQuery(apiApp)
        apiService.statsQuery = new StatsQuery(apiApp)
        apiService.rankService = new RankService(apiApp)
        apiService.homepageDashboard = new HomepageDashboard(apiApp);
        apiService.nftCheckerService = new NFTCheckerService(apiApp);
        apiService.nftPreviewService = new NFTPreviewService(apiApp);
        apiService.ensCheckerQuery = new ENSCheckerQuery(apiApp);
        const accountQuery = new AccountQuery(apiApp);
        apiService.accountQuery = accountQuery;
        const tokenTool = new TokenTool(this.cfx)
        apiService.tokenTool = tokenTool
        apiService.tokenQuery = new TokenQuery(apiApp)
        apiService.contractQuery = new ContractQuery({cfx: this.cfx, config: this.config,
            tokenQuery: apiService.tokenQuery, tokenTool})
        apiService.ipfsGatewaySync = new IPFSGatewaySync();
        apiService.txnQuery = new TxnQuery()
        apiService.txnSync = new TxnSync({cfx: this.cfx, accountQuery})
        apiService.traceCreateQuery = new ContractTraceCreateQuery({cfx: this.cfx});
        apiService.balanceService = new BalanceService(this, StatApp.networkId)
        apiService.cfx = this.cfx;
        apiService.eth = this.eth;
        apiService.logger = logger;
        this.initModule();
        await this.initMetrics(apiService);

        let utilContract = await BatchBalanceWatcher.getUtilContractAddr();
        console.log(` util contract ${utilContract}`)
        new BatchBalanceWatcher(this.cfx, utilContract)
        await apiService.txnQuery.scheduleCache()
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
        return apiService.metrics.init();
    }
}
async function initBilling(config: StatConfig) {
    const billingApp = config.billingApp;
    if (!billingApp) {
        console.log(`billing app not set`)
        return
    }
    await initWeb3payVipClient(config.ether.url, billingApp,);
    console.log(`using billing app ${billingApp}, now test...`)
    try {
        const result = await getVipInfo(billingApp)
        console.log(`get vip info test:`, result);
    } catch (e) {
        console.log(`test web3pay fail:`, e)
    }
}
export function initApiServer() {
    regExitHook();
    redirectLog({mainPath:'OpenApi'})
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
        scheduleSwaggerReporter(apiServer.config, port, 'OpenApi', 'open/swagger-stats').then();
        app.listen(port)
        console.log(`/open api server listen at ${port}`)
    })
}

if (module === require.main) {
    initApiServer()
}
