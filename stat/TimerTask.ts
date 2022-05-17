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
import {KV} from "./model/KV";
import {DailyContractStatSync} from "./service/DailyContractStatSync";
import {DailyContractRegisterSync} from "./service/DailyContractRegisterSync";
import {CfxHolderSync} from "./service/CfxHolderSync";
import {DailyBlockDataStatSync} from "./service/DailyBlockDataStatSync";
import {regExitHook} from "./service/tool/ProcessTool";

async function main() {
    redirectLog()
    regExitHook()

    const cfg = await init()
    const cfx = new Conflux(cfg.conflux)
    patchHttpProvider(cfx, cfg.conflux, 'TimerTask')
    await cfx.updateNetworkId();
    const cfxStatus:any = await cfx.getStatus()
    StatApp.networkId = cfxStatus.networkId
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
}
main().then().catch(err=>{
    console.log(`Timer task fail:`, err)
})