import {Conflux} from "js-conflux-sdk";

const Koa = require('koa');
const app = new Koa();
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
import {BatchBalanceWatcher} from "../stat/service/watcher/BatchBalanceWatcher";
import {setRateControlDB} from "./router/middleware";
import {ContractQuery} from "../stat/service/ContractQuery";
import {TokenQuery} from "../stat/service/TokenQuery";
import {TokenTool} from "../stat/service/tool/TokenTool";
const DailyRotateFile = require('winston-daily-rotate-file');
const winston = require('winston');

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
    crc721transferQuery: Crc721TransferQuery
    crc1155transferQuery: Crc1155TransferQuery
    logger: any
    tokenQuery: TokenQuery;
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
    cfx: Conflux;
    config: StatConfig

    constructor() {
        this.config = config
        this.cfx = new Conflux(config.conflux)
    }

    public async init() {
        logger.info(`-------- start api server --------`)
        patchHttpProvider(this.cfx, config.conflux)
        // @ts-ignore
        await this.cfx.updateNetworkId();
        const cfxStatus:any = await this.cfx.getStatus()
        StatApp.networkId = cfxStatus.networkId
        StatApp.readonly = config.database.readonly
        const sequelize = createDB(config.database)
        await initModel(sequelize)
        // await sequelize.sync({})
        await RedisWrap.connect(config.redis)
        setRateControlDB(redisWrap.client)
        apiService = new ApiService()
        const apiApp = {networkId:cfxStatus.networkId};
        apiService.fullBlockQuery = new FullBlockQuery(apiApp)
        apiService.crc20transferQuery = new Crc20TransferQuery(apiApp)
        apiService.crc721transferQuery = new Crc721TransferQuery(apiApp)
        apiService.crc1155transferQuery = new Crc1155TransferQuery(apiApp)
        const tokenTool = new TokenTool(this.cfx)
        apiService.tokenQuery = new TokenQuery({tokenTool})
        apiService.contractQuery = new ContractQuery({tokenQuery: apiService.tokenQuery})
        apiService.logger = logger
        new BatchBalanceWatcher(this.cfx, [], null, await BatchBalanceWatcher.getUtilContractAddr())
        // test
        // logger.info(`simple message`, 1)
        // logger.error('what about the error ?', new Error('here is error msg'))
    }
}

export function initApiServer() {
    const apiServer = new ApiServer();
    apiServer.init().then(()=>{
        return register(app, apiServer)
    }).then(()=>{
        const port = apiServer.config.apiPort || 9527;
        app.listen(port)
        console.log(`api server listen at ${port}`)
    })
}

if (module === require.main) {
    initApiServer()
}