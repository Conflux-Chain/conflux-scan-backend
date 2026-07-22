import {redirectLog} from "./service/tool/LoggerConfig";
import {init} from "./service/tool/FixDailyTokenStat";
import {getTimeToNextHour, initCfxSdk, MINUTE} from "./service/common/utils";
import {StatApp} from "./StatApp";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {removeDate1970, scheduleDailyActiveAddress} from "./model/StatAddress";
import {scheduleDailyTokenStat} from "./service/DailyTokenSync";
import {calcDailyUniqueAddrSchedule} from "./service/UniqueAddressStat";
import {
    ADDRESS_COUNT_ALL,
    ADDRESS_COUNT_ID,
    CONTRACT_COUNT_ALL, CONTRACT_COUNT_ID,
    VERIFIED_COUNT_ALL, VERIFIED_COUNT_ID,
    IS_EVM2, KEY_FULL_STATE_RPC, KEY_SUPRESS_FULLSTATE_RPC_ERR,
    KV
} from "./model/KV";
import {regExitHook} from "./service/tool/ProcessTool";
import {Hex40Map} from "./model/HexMap";
import {TraceCreateContract} from "./model/TraceCreateContract";
import {Reporter} from "./service/syncalert/Reporter";
import {StatDailyBlockData} from "./service/timerstat/StatDailyBlockData";
import {StatDailyContractAnalysis} from "./service/timerstat/StatDailyContractAnalysis";
import {StatDailyContractCreation} from "./service/timerstat/StatDailyContractCreation";
import {StatDailyContractRegister} from "./service/timerstat/StatDailyContractRegister";
import {StatDailyTxn} from "./service/timerstat/StatDailyTxn";
import {StatTotalCfxHolder} from "./service/timerstat/StatTotalCfxHolder";
import {StatDailyNFT} from "./service/timerstat/StatDailyNFT";
import {StatTotalNFTHolder} from "./service/timerstat/StatTotalNFTHolder";
import {Op} from "sequelize";
import {CensorService} from "./service/censor/CensorService";
import {StatDailyPosReward} from "./service/timerstat/StatDailyPosReward";
import {StatDailyPowReward} from "./service/timerstat/StatDailyPowReward";
import {KEY_STAT_TASK, repeatHeartBeat} from "./model/HeartBeat";
import {StatDailyBurntFee} from "./service/timerstat/StatDailyBurntFee";
import {statGasConsumer} from "./service/TxnQuery";
import {TokenSecurityAuditSync} from "./service/TokenSecurityAuditSync";
import {scheduleRollupDailyCfxTxn} from "./model/CfxTransfer";
import {listenPort} from "./monitor/serverApi";
import {buildTxSenderReceiverHourly} from "./PeriodTxnSummary";
import {safeAddErrorLog} from "./monitor/ErrorMonitor";
import {checkAllTableDataTime} from "./monitor/DataTimeChecker";
import {StatDailyGas} from "./service/timerstat/StatDailyGas";
import {ContractQuery} from "./service/ContractQuery";
import {TokenQuoteSync} from "./service/TokenQuoteSync";
import {ContractDappNameSync} from "./service/ContractDappNameSync";
import {VerifiedContracts} from "./model/VerifiedContracts";
import {StatDailyContractVerified} from "./service/timerstat/StatDailyContractVerified";
import {TokenAutoDetect} from "./service/TokenAutoDetect";

async function runTools() {
    const [,, cmd, arg1] = process.argv;
    let quit = true;
    if (cmd === 'build-periodic-tx') {
        await init();
        await buildTxSenderReceiverHourly()
    } else {
        quit = false;
    }
    if (quit) {
        if (KV.sequelize) {
            await KV.sequelize.close();
        }
        process.exit(0);
    }
}

// node stat/StatTask.js build-periodic-tx

async function main() {
    await runTools();
    redirectLog()
    regExitHook()
    const config = await init()
    const cfx = await initCfxSdk(config.conflux, 'StatTask');
    StatApp.networkId = cfx.networkId;
    StatApp.isEVM = await KV.getSwitch(IS_EVM2);

    removeDate1970().then();
    scheduleDailyTokenStat().then()
    scheduleDailyActiveAddress().then()
    calcDailyUniqueAddrSchedule().then()
    scheduleRollupDailyCfxTxn().then();
    setInterval(countTable, 60_000)
    runAllPeriodicStat().then();
    const blockAndMinerSync = new BlockAndMinerSync();
    blockAndMinerSync.schedule().then();

    new Reporter({config, cfx});
    new StatDailyBlockData({cfx});
    new StatDailyGas({cfx});
    new StatDailyContractAnalysis({cfx});
    new StatDailyContractCreation({cfx})
    new StatDailyContractVerified({cfx})
    new StatDailyContractRegister({cfx});
    new StatDailyTxn({cfx});
    new StatDailyNFT({cfx});
    new StatTotalNFTHolder({cfx});
    new StatTotalCfxHolder({cfx});
    new StatDailyPosReward({cfx});
    new StatDailyPowReward({cfx});
    new ContractDappNameSync({cfx});
    new TokenSecurityAuditSync({cfx});
    new TokenQuoteSync(cfx, config.quote);
    new TokenAutoDetect(cfx);
    new CensorService(cfx, config.censor, {tx: 10, token: 10, nft: 10, ens: 10});

    const contractQuery = new ContractQuery({cfx, config: config.verification});
    contractQuery.scheduleUpdateCompilerVersions().then();
    contractQuery.scheduleVerifyByAuto().then();
    contractQuery.scheduleStatTxnVolume().then();
    contractQuery.scheduleWithNametag().then();

    if (!StatApp.isEVM) {
        let fullCfx = cfx;
        const fullStateRpc = await KV.getString(KEY_FULL_STATE_RPC, "");
        if (fullStateRpc) {
            fullCfx = await initCfxSdk({url: fullStateRpc});
        }
        const suppressFullStateRpcErr = await KV.getSwitch(KEY_SUPRESS_FULLSTATE_RPC_ERR);
        new StatDailyBurntFee({cfx: fullCfx, suppressFullStateRpcErr});
    }

    repeatHeartBeat(KEY_STAT_TASK+config.serverTag)
    console.log(`----- Stat tasks scheduled. -----`)
}
async function countTable() {
    await countTableDelta(Hex40Map, ADDRESS_COUNT_ALL, ADDRESS_COUNT_ID);
    await countTableDelta(TraceCreateContract, CONTRACT_COUNT_ALL, CONTRACT_COUNT_ID);
    await countTableDelta(VerifiedContracts, VERIFIED_COUNT_ALL, VERIFIED_COUNT_ID);
}

async function countTableDelta(model, keyCountAll, keyCountId) {
    const [count, lastId, latestBean] = await Promise.all([
        KV.getNumber(keyCountAll, 0),
        KV.getNumber(keyCountId, 0),
        model.findOne({attributes: ['id'], order: [['id', 'desc']]}),
    ]);

    const latestId = latestBean?.id || 0;
    const delta = await model.count({
        where: {
            [Op.and]: [
                {id: {[Op.gt]: lastId}},
                {id: {[Op.lte]: latestId}}
            ]
        },
    });

    await KV.sequelize.transaction(async (dbTx) => {
        await KV.upsert({key: keyCountAll, value: `${count + delta}`}, {transaction: dbTx});
        await KV.upsert({key: keyCountId, value: `${latestId}`}, {transaction: dbTx});
    });
}

let timer: NodeJS.Timeout;
async function runAllPeriodicStat() {
    if (timer) {
        clearTimeout(timer);
    }
    await buildTxSenderReceiverHourly().catch(e=>{
        safeAddErrorLog(`stat-task`, 'tx-sender-receiver', e);
    });
    await statGasConsumer(new Date()).catch(e=>{
        safeAddErrorLog('stat-task', 'gas-consumer', e).then();
        console.log(`stat Gas Consumer error`, e)
    });

    await checkAllTableDataTime().catch(e=>{
        safeAddErrorLog('stat-task', 'check-data-delay', e).then();
    })

    // next round
    timer = setTimeout(runAllPeriodicStat, getTimeToNextHour() + MINUTE * 10);
}

if (module === require.main) {
    main().then(()=>{
        return listenPort('stat_task')
    }).catch(err => {
        console.log(`Stat task fail:`, err)
    })
}
