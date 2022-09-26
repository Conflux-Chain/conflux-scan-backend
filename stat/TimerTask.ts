import {redirectLog} from "./config/LoggerConfig";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {StatApp} from "./StatApp";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {scheduleDailyActiveAddress} from "./model/StatAddress";
import {scheduleDailyTokenStat} from "./service/DailyTokenSync";
import {calcDailyUniqueAddrSchedule} from "./service/UniqueAddressStat";
import {ADDRESS_COUNT, CONTRACT_COUNT, IS_EVM2, KV} from "./model/KV";
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

async function main() {
    redirectLog()
    regExitHook()

    const cfg = await init()
    const cfx = new Conflux(cfg.conflux)
    patchHttpProvider(cfx, cfg.conflux, 'TimerTask')
    await cfx.updateNetworkId();
    const cfxStatus:any = await cfx.getStatus()
    StatApp.networkId = cfxStatus.networkId
    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
    //
    const blockAndMinerSync = new BlockAndMinerSync();
    await blockAndMinerSync.schedule()
    //
    await scheduleDailyActiveAddress()
        .then(()=>{scheduleDailyTokenStat()})
    await calcDailyUniqueAddrSchedule().then()
    //
    const reporter = new Reporter({config: cfg, cfx});
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
    const statTotalCfxHolder = new StatTotalCfxHolder({cfx});
    await statTotalCfxHolder.schedule(1000 * 6);
    //
    setInterval(countTable, 60_000)
    console.log(`----- Timer tasks scheduled. -----`)
}
async function countTable() {
    await KV.saveNumber(ADDRESS_COUNT, await Hex40Map.count({}), null)
    await KV.saveNumber(CONTRACT_COUNT, await TraceCreateContract.count({}), null)
}
main().then().catch(err=>{
    console.log(`Timer task fail:`, err)
})