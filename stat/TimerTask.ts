import {redirectLog} from "./config/LoggerConfig";
import {init} from "./service/tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {StatApp} from "./StatApp";
import {BlockAndMinerSync} from "./service/BlockAndMinerSync";
import {scheduleDailyActiveAddress} from "./model/StatAddress";
import {DailyTxnSync, scheduleDailyTokenStat} from "./service/DailyTxnSync";
import {calcDailyUniqueAddrSchedule} from "./service/UniqueAddressStat";
import {DailyContractCreateSync} from "./service/DailyContractCreateSync";
import {ADDRESS_COUNT, CONTRACT_COUNT, IS_EVM2, KV} from "./model/KV";
import {DailyContractStatSync} from "./service/DailyContractStatSync";
import {DailyContractRegisterSync} from "./service/DailyContractRegisterSync";
import {CfxHolderSync} from "./service/CfxHolderSync";
import {DailyBlockDataStatSync} from "./service/DailyBlockDataStatSync";
import {regExitHook} from "./service/tool/ProcessTool";
import {Hex40Map} from "./model/HexMap";
import {TraceCreateContract} from "./model/TraceCreateContract";
import {Reporter} from "./service/syncalert/Reporter";

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
    const dailyTxnSync = new DailyTxnSync();
    await dailyTxnSync.schedule(); // dailyTxn
    await scheduleDailyActiveAddress()
        .then(()=>{scheduleDailyTokenStat()})
    await calcDailyUniqueAddrSchedule().then()
    //
    const contractCreateSync = new DailyContractCreateSync(KV.sequelize)
    await contractCreateSync.schedule(); // dailyContractCreate
    //
    const contractStatSync = new DailyContractStatSync(KV.sequelize);
    await contractStatSync.schedule();
    //
    const contractRegisterSync = new DailyContractRegisterSync(KV.sequelize);
    await contractRegisterSync.schedule(); // dailyContractRegister
    //
    const cfxHolderSync = new CfxHolderSync(KV.sequelize);
    await cfxHolderSync.schedule(); // dailyCfxHolder
    //
    const blockDataStatSync = new DailyBlockDataStatSync();
    await blockDataStatSync.schedule(); // daily block data stat
    //
    const reporter = new Reporter({config: cfg, cfx});
    await reporter.start(); // scan sync alert
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