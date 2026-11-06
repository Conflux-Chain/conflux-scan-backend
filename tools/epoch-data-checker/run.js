"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../../stat/service/common/utils");
const DBProvider_1 = require("../../stat/service/DBProvider");
const KV_1 = require("../../stat/model/KV");
const Epoch_1 = require("../../stat/model/Epoch");
const HexMap_1 = require("../../stat/model/HexMap");
const FullBlock_1 = require("../../stat/model/FullBlock");
const CfxTransfer_1 = require("../../stat/model/CfxTransfer");
const Erc20Transfer_1 = require("../../stat/model/Erc20Transfer");
const Erc721Transfer_1 = require("../../stat/model/Erc721Transfer");
const Erc1155Transfer_1 = require("../../stat/model/Erc1155Transfer");
const AddrTransfer_1 = require("../../stat/model/AddrTransfer");
const NftTransfer_1 = require("../../stat/model/NftTransfer");
const NftTransfer_2 = require("../../stat/model/NftTransfer");
const TraceCreateContract_1 = require("../../stat/model/TraceCreateContract");
const NameTag_1 = require("../../stat/model/NameTag");
const CensorItem_1 = require("../../stat/model/CensorItem");
const Epoch_2 = require("../../stat/model/Epoch");
const CheckerConfig_1 = require("./CheckerConfig");
const Checker_1 = require("./Checker");
const CursorStore_1 = require("./CursorStore");
const Control_1 = require("./Control");
const StatApp_1 = require("../../stat/StatApp");
async function run() {
    console.log(`[epoch-checker] starting pid=${process.pid} host=${require('os').hostname()}`);
    const config = CheckerConfig_1.loadCheckerConfig();
    const args = process.argv.slice(2);
    const direction = (args[args.indexOf('--direction') + 1] || 'both');
    const interval = Number(args[args.indexOf('--interval') + 1] || 10) * 1000;
    const cfx = await utils_1.initCfxSdk(config.conflux);
    StatApp_1.StatApp.networkId = cfx.networkId;
    console.log(`[epoch-checker] rpc networkId=${cfx.networkId}`);
    const sequelize = DBProvider_1.createDB({ ...config.database, readonly: true });
    // Register only the read models needed by this tool.  initModel() also
    // runs production schema migration helpers, which is deliberately avoided.
    KV_1.KV.register(sequelize);
    Epoch_1.Epoch.register(sequelize);
    Epoch_1.Epoch.removeAttribute('id');
    HexMap_1.Hex40Map.register(sequelize);
    FullBlock_1.FullBlock.register(sequelize);
    FullBlock_1.FullBlock.removeAttribute('id');
    FullBlock_1.FullTransaction.register(sequelize);
    FullBlock_1.FullTransaction.removeAttribute('id');
    CfxTransfer_1.CfxTransfer.register(sequelize);
    Erc20Transfer_1.Erc20Transfer.register(sequelize);
    Erc721Transfer_1.Erc721Transfer.register(sequelize);
    Erc1155Transfer_1.Erc1155Transfer.register(sequelize);
    AddrTransfer_1.AddressTransfer.register(sequelize);
    AddrTransfer_1.AddressTransfer.removeAttribute('id');
    AddrTransfer_1.EpochAddressIds.register(sequelize);
    AddrTransfer_1.EpochAddressIds.removeAttribute('id');
    NftTransfer_1.NftTransfer.register(sequelize);
    NftTransfer_2.AddressNftTransfer.register(sequelize);
    NftTransfer_2.AddressNftTransfer.removeAttribute('id');
    TraceCreateContract_1.ContractDestroy.register(sequelize);
    NameTag_1.NameTag.register(sequelize);
    CensorItem_1.CensorItem.register(sequelize);
    Epoch_2.VoteParams.register(sequelize);
    Epoch_2.VoteParams.removeAttribute('id');
    const checker = new Checker_1.EpochDataChecker(cfx, config);
    const latest = await checker.latestFinalized();
    console.log(`[epoch-checker] latest finalized=${latest}`);
    await checker.initialize(latest);
    if (args.includes('--resume')) {
        const resume = args[args.indexOf('--resume') + 1];
        if (resume === 'forward' || resume === 'backward')
            await (new CursorStore_1.CursorStore()).resume(resume);
    }
    const once = args.includes('--once');
    if (args.includes('--stop')) {
        await Control_1.setEnabled(false);
        return;
    }
    await Control_1.setEnabled(true);
    if (!await Control_1.acquireLease()) {
        console.log('[epoch-checker] another instance owns the lease; exiting');
        return;
    }
    console.log('[epoch-checker] lease acquired');
    do {
        if (!await Control_1.isEnabled()) {
            console.log('[epoch-checker] disabled by admin; stopping');
            break;
        }
        if (!await Control_1.renewLease()) {
            console.log('[epoch-checker] lease lost; stopping');
            break;
        }
        const directions = direction === 'both' ? ['forward', 'backward'] : [direction];
        console.log(`[epoch-checker] checking ${directions.join(',')}`);
        await Promise.all(directions.map(async (item) => {
            try {
                await checker.run(item);
            }
            catch (error) {
                console.error(`[epoch-checker] ${item} failed`, error);
            }
        }));
        if (once)
            break;
        await new Promise(resolve => setTimeout(resolve, interval));
    } while (true);
    await Control_1.releaseLease();
    console.log('[epoch-checker] stopped');
    await KV_1.KV.sequelize.close();
}
run().catch(async (error) => {
    console.error(error);
    if (KV_1.KV.sequelize)
        await KV_1.KV.sequelize.close().catch(() => undefined);
    process.exitCode = 1;
});
