import {Conflux, format} from "js-conflux-sdk";
import {ethers} from "ethers";
import {loadConfig, StatConfig} from "../stat/config/StatConfig";
import {patchHttpProvider} from "../stat/service/common/utils";
import {StatApp} from "../stat/StatApp";
import {createDB, initModel} from "../stat/service/DBProvider";
import {redisWrap, RedisWrap} from "../stat/service/RedisWrap";
import {register} from "./router/ApiRouter";
import {FullBlockQuery} from "../stat/service/FullBlockQuery";
import {Crc20TransferQuery} from "../stat/service/Crc20TransferQuery";
import {Crc721TransferQuery} from "../stat/service/Crc721TransferQuery";
import {Crc1155TransferQuery} from "../stat/service/Crc1155TransferQuery";
import {Crc3525TransferQuery} from "../stat/service/Crc3525TransferQuery";
import {BatchBalanceWatcher} from "../stat/service/watcher/BatchBalanceWatcher";
import {setRateControlDB} from "./router/middleware";
import {ContractQuery} from "../stat/service/ContractQuery";
import {TokenQuery} from "../stat/service/TokenQuery";
import {TokenTool} from "../stat/service/tool/TokenTool";
import {CfxTransferQuery} from "../stat/service/CfxTransferQuery";
import {DailyBlockDataStatQuery} from "../stat/service/DailyBlockDataStatQuery";
import {MarketDataQuery} from "../stat/service/MarketDataQuery";
import {DailyContractCreateQuery} from "../stat/service/DailyContractCreateQuery";
import {CfxHolderQuery} from "../stat/service/CfxHolderQuery";
import {DailyTxnQuery} from "../stat/service/DailyTxnQuery";
import {AddrTransactionHandler} from "../stat/service/streamstat/business/AddrTransactionHandler";
import {MinerBlockHandler} from "../stat/service/streamstat/business/MinerBlockHandler";
import {AddrCfxTransferHandler} from "../stat/service/streamstat/business/AddrCfxTransferHandler";
import {TokenTransferHandler} from "../stat/service/streamstat/business/TokenTransferHandler";
import {RankService} from "../stat/service/RankService";
import {NFTPreviewService} from "../stat/service/nftchecker/NFTPreviewService";
import {NFTCheckerService} from "../stat/service/nftchecker/NFTCheckerService";
import {IS_EVM2, KEY_FASTEST_IPFS_GATEWAY, KV} from "../stat/model/KV";
import {Metrics} from "./common/Metrics";
import {CONST} from "../stat/service/common/constant"
import {AddrTransferQuery} from "../stat/service/AddrTransferQuery";
import {billing, getVipInfo, initWeb3payClient, initWeb3payVipClient} from "web3pay-sdk-js/lib/rpc";
import {IPFSGatewaySync} from "../stat/service/IPFSGatewaySync";
import {ENSCheckerQuery} from "../stat/service/ens/ENSCheckerQuery";
import {AccountQuery} from "../stat/service/AccountQuery";
import {redirectLog} from "../stat/config/LoggerConfig";
import {regExitHook} from "../stat/service/tool/ProcessTool";
import {checkTest} from "./test/Testcase";

const Koa = require('koa');
const lodash = require('lodash');
const app = new Koa();
const DailyRotateFile = require('winston-daily-rotate-file');
const winston = require('winston');
const JsonRPCSDK = require('../common/JsonRPCSDK');

const config = loadConfig('Prod')
let apiService: ApiService
let logger
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
    addrTransactionHandler : AddrTransactionHandler;
    minerBlockHandler : MinerBlockHandler;
    addrCfxTransferHandler : AddrCfxTransferHandler;
    tokenTransferHandler : TokenTransferHandler;
    ipfsGatewaySync: IPFSGatewaySync;
    cfx: Conflux;
    eth;
    jsonRpc;
    logger: any
    moduleSet: Set<string>;
    actionSet: Set<string>;
    metrics: Metrics;
}

export function createLogger(tag) {
    const { combine, timestamp, label, printf } = winston.format;
    const myFormat = printf(({ level, message, label, timestamp, stack }) => {
        if (stack) {
            const str: string = stack
            let firstLine = str.substr(0, str.indexOf('\n'))
            firstLine = firstLine.substr(firstLine.indexOf(":")+1)
            const idx = message.indexOf(firstLine)
            if (idx >= 0) {
                message = message.substr(0, idx)
            }
            return `${timestamp} [${label}] ${level}: ${message}\n${stack}`;
        }
        return `${timestamp} [${label}] ${level}: ${message}`;
    });
    logger = winston.createLogger({
        level: 'info',
        format: combine(
            label({ label: 'open-api' }),
            timestamp(),
            myFormat
        ),
        defaultMeta: { tag },
        transports: [
            //
            // - Write all logs with level `error` and below to `error.log`
            // - Write all logs with level `info` and below to `combined.log`
            //
            new winston.transports.Console(),
            new DailyRotateFile({dirname: './log/open-api',
                filename: 'error.%DATE%.log', level: 'error',
                maxSize: '100mb', maxFiles: '20d', createSymlink: true, symlinkName: 'error.log'
            }),
            new DailyRotateFile({dirname: './log/open-api',
                filename: 'info.%DATE%.log', level: 'info',
                maxSize: '100mb', maxFiles: '20d', createSymlink: true, symlinkName: 'info.log'
            }),
        ],
    });
}
createLogger('apiServer')
export class ApiServer {
    config: StatConfig
    cfx: Conflux;
    eth;

    constructor() {
        this.config = config
        this.cfx = new Conflux(config.conflux)
        this.eth = new ethers.providers.JsonRpcProvider(config.ether.url)
    }

    public async init() {
        logger.info(`-------- start api server, port ${config.apiPort}--------`)
        patchHttpProvider(this.cfx, config.conflux)
        // @ts-ignore
        await this.cfx.updateNetworkId();
        const cfxStatus:any = await this.cfx.getStatus()
        StatApp.networkId = cfxStatus.networkId

        StatApp.readonly = config.database.readonly
        const sequelize = createDB(config.databaseRW)
        await initModel(sequelize)
        // await sequelize.sync({})

        await RedisWrap.connect(config.redis)
        setRateControlDB(redisWrap.client)

        StatApp.isEVM = await KV.getSwitch(IS_EVM2);

        apiService = new ApiService()
        const apiApp = {networkId:cfxStatus.networkId, cfx: this.cfx, service: apiService, config: this.config};
        apiService.fullBlockQuery = new FullBlockQuery(apiApp)
        apiService.crc20transferQuery = new Crc20TransferQuery(apiApp)
        apiService.cfxTransferQuery = new CfxTransferQuery(apiApp)
        apiService.crc721transferQuery = new Crc721TransferQuery(apiApp)
        apiService.crc1155transferQuery = new Crc1155TransferQuery(apiApp)
        apiService.crc3525transferQuery = new Crc3525TransferQuery(apiApp)
        apiService.addrTransferQuery = new AddrTransferQuery(apiApp)
        apiService.dailyBlockDataStatQuery = new DailyBlockDataStatQuery(apiApp)
        apiService.rankService = new RankService(apiApp)
        apiService.marketDataQuery = new MarketDataQuery(apiApp);
        apiService.contractCreateQuery = new DailyContractCreateQuery();
        apiService.cfxHolderQuery = new CfxHolderQuery();
        apiService.dailyTxnQuery = new DailyTxnQuery();
        apiService.nftCheckerService = new NFTCheckerService(apiApp);
        apiService.nftPreviewService = new NFTPreviewService(apiApp);
        apiService.ensCheckerQuery = new ENSCheckerQuery(apiApp);
        apiService.accountQuery = new AccountQuery(apiApp);
        apiService.addrTransactionHandler = new AddrTransactionHandler(apiApp);
        apiService.minerBlockHandler = new MinerBlockHandler(apiApp);
        apiService.addrCfxTransferHandler = new AddrCfxTransferHandler(apiApp);
        apiService.tokenTransferHandler = new TokenTransferHandler(apiApp);
        const tokenTool = new TokenTool(this.cfx)
        apiService.tokenTool = tokenTool
        apiService.tokenQuery = new TokenQuery({tokenTool})
        apiService.jsonRpc = new JsonRPCSDK(config.jsonRpc);
        apiService.contractQuery = new ContractQuery({cfx: this.cfx, config: this.config, jsonRpc: apiService.jsonRpc,
            tokenQuery: apiService.tokenQuery})
        apiService.ipfsGatewaySync = new IPFSGatewaySync(apiApp);
        apiService.cfx = this.cfx;
        apiService.eth = this.eth;
        apiService.logger = logger
        await this.initModule();
        await this.initMetrics(apiService);

        let utilContract = await BatchBalanceWatcher.getUtilContractAddr();
        console.log(` util contract ${utilContract}`)
        new BatchBalanceWatcher(this.cfx, null, utilContract)
        await apiService.addrTransactionHandler.scheduleCache();
        await apiService.minerBlockHandler.scheduleCache();
        await apiService.addrCfxTransferHandler.scheduleCache();
        await apiService.tokenTransferHandler.scheduleCache();
        config.asyncVerifySourcecode && (await apiService.contractQuery.schedule());
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
        // const result = await billing('/', true, key)
        // if (result.code == 0) {
        //     console.log(`test billing ok`, result)
        // } else {
        //     console.log(`test billing , result :`, result)
        // }
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
        app.listen(port)
        console.log(`api server listen at ${port}`)
    })
}
if (module === require.main) {
    initApiServer()
}
