import {redirectLog} from "./config/LoggerConfig";
import {init} from "./service/tool/FixDailyTokenStat";
import {initCfxSdk} from "./service/common/utils";
import {StatApp} from "./StatApp";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {scheduleDailyActiveAddress} from "./model/StatAddress";
import {scheduleDailyTokenStat} from "./service/DailyTokenSync";
import {calcDailyUniqueAddrSchedule} from "./service/UniqueAddressStat";
import {BlockTraceCreateQuery} from "./service/BlockTraceCreateQuery";
import {
    ADDRESS_COUNT_ALL,
    ADDRESS_COUNT_ID,
    CONTRACT_COUNT_ALL, CONTRACT_COUNT_ID,
    IS_EVM2,
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
import {RedisWrap} from "./service/RedisWrap";
import {TokenTransferHandler} from "./service/streamstat/business/TokenTransferHandler";
import {MinerBlockHandler} from "./service/streamstat/business/MinerBlockHandler";
import {AddrTransactionHandler} from "./service/streamstat/business/AddrTransactionHandler";
import {AddrCfxTransferHandler} from "./service/streamstat/business/AddrCfxTransferHandler";
import {DailyCfxTransferHandler} from "./service/streamstat/business/DailyCfxTransferHandler";
import {DailyTokenTransferHandler} from "./service/streamstat/business/DailyTokenTransferHandler";
import {NFTMintHandler} from "./service/streamstat/business/NFTMintHandler";
import {KEY_STAT_TASK, repeatHeartBeat} from "./model/HeartBeat";

async function main() {
    redirectLog()
    regExitHook()

    const config = await init()
    const cfx = await initCfxSdk(config.conflux, 'StatTask');
    await RedisWrap.connect(config.redis);
    StatApp.networkId = cfx.networkId;
    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
    const traceCreateQuery = new BlockTraceCreateQuery({});
    //
    const blockAndMinerSync = new BlockAndMinerSync();
    await blockAndMinerSync.schedule()
    //
    const censorService = new CensorService({config, cfx, traceCreateQuery},
        {tx: 10, token: 10, nft: 10});
    await censorService.schedule(1000 * 3);
    //
    await scheduleDailyActiveAddress()
        .then(()=>{scheduleDailyTokenStat()})
    await calcDailyUniqueAddrSchedule().then()
    //
    const reporter = new Reporter({config, cfx});
    await reporter.start();
    //
    const statDailyBlockData = new StatDailyBlockData({cfx});
    await statDailyBlockData.schedule(1000 * 6);
    //
    const statDailyContractAnalysis = new StatDailyContractAnalysis({cfx});
    await statDailyContractAnalysis.schedule();
    //
    const statDailyContractCreation = new StatDailyContractCreation({cfx})
    await statDailyContractCreation.schedule(1000 * 6);
    //
    const statDailyContractRegister = new StatDailyContractRegister({cfx});
    await statDailyContractRegister.schedule(1000 * 6);
    //
    const statDailyTxn = new StatDailyTxn({cfx});
    await statDailyTxn.schedule(1000 * 6);
    //
    const statDailyNFT = new StatDailyNFT({cfx});
    await statDailyNFT.schedule(1000 * 1);
    //
    const statTotalNFTHolder = new StatTotalNFTHolder({cfx});
    await statTotalNFTHolder.schedule(1000 * 3);
    //
    const statTotalCfxHolder = new StatTotalCfxHolder({cfx});
    await statTotalCfxHolder.schedule(1000 * 6);
    //
    const statDailyPosReward = new StatDailyPosReward({cfx});
    await statDailyPosReward.schedule(1000 * 1);
    //
    const statDailyPowReward = new StatDailyPowReward({cfx});
    await statDailyPowReward.schedule(1000 * 1);
    //
    await startStreamStat(cfx, config)
    //
    setInterval(countTable, 60_000)
    //
    repeatHeartBeat(KEY_STAT_TASK+config.serverTag)
    console.log(`----- Stat tasks scheduled. -----`)
}
async function countTable() {
    await countTableDelta(Hex40Map, ADDRESS_COUNT_ALL, ADDRESS_COUNT_ID);
    await countTableDelta(TraceCreateContract, CONTRACT_COUNT_ALL, CONTRACT_COUNT_ID);
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

async function startStreamStat(cfx, config) {
    if (config.streamStat) {
        const app = {cfx};
        const tokenTransferHandler = new TokenTransferHandler(app);
        const minerBlockHandler = new MinerBlockHandler(app);
        const addrTransactionHandler = new AddrTransactionHandler(app);
        const addrCfxTransferHandler = new AddrCfxTransferHandler(app);
        const dailyCfxTransferHandler = new DailyCfxTransferHandler(app);
        const dailyTokenTransferHandler = new DailyTokenTransferHandler(app);
        const dailyNFTMintHandler = new NFTMintHandler(app);

        config.statTokenTransfer && (await tokenTransferHandler.schedule(1000 * 60 * 10));
        config.statMinerBlock && (await minerBlockHandler.schedule(1000 * 60 * 10));
        config.statAddrTransaction && (await addrTransactionHandler.schedule(1000 * 60 * 10));
        config.statAddrCfxTransfer && (await addrCfxTransferHandler.schedule(1000 * 60 * 10));
        config.statDailyCfxTransfer && (await dailyCfxTransferHandler.schedule(1000 * 60 * 10));
        config.statDailyTokenTransfer && (await dailyTokenTransferHandler.schedule(1000 * 60 * 10));
        config.statNFTMint && (await dailyNFTMintHandler.schedule(1000 * 60 * 10));
    }
}

main().then().catch(err=>{
    console.log(`Stat task fail:`, err)
})