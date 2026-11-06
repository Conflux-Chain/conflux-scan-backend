import {initCfxSdk} from '../../stat/service/common/utils';
import {createDB} from '../../stat/service/DBProvider';
import {KV} from '../../stat/model/KV';
import {Epoch} from '../../stat/model/Epoch';
import {Hex40Map} from '../../stat/model/HexMap';
import {FullBlock, FullTransaction} from '../../stat/model/FullBlock';
import {CfxTransfer} from '../../stat/model/CfxTransfer';
import {Erc20Transfer} from '../../stat/model/Erc20Transfer';
import {Erc721Transfer} from '../../stat/model/Erc721Transfer';
import {Erc1155Transfer} from '../../stat/model/Erc1155Transfer';
import {AddressTransfer, EpochAddressIds} from '../../stat/model/AddrTransfer';
import {NftTransfer} from '../../stat/model/NftTransfer';
import {AddressNftTransfer} from '../../stat/model/NftTransfer';
import {ContractDestroy} from '../../stat/model/TraceCreateContract';
import {NameTag} from '../../stat/model/NameTag';
import {CensorItem} from '../../stat/model/CensorItem';
import {VoteParams} from '../../stat/model/Epoch';
import {loadCheckerConfig} from './CheckerConfig';
import {EpochDataChecker, Direction} from './Checker';
import {CursorStore} from './CursorStore';
import {acquireLease, isEnabled, releaseLease, renewLease, setEnabled} from './Control';
import {StatApp} from '../../stat/StatApp';

async function run() {
    console.log(`[epoch-checker] starting pid=${process.pid} host=${require('os').hostname()}`);
    const config = loadCheckerConfig();
    const args = process.argv.slice(2);
    const direction = (args[args.indexOf('--direction') + 1] || 'both') as 'both'|Direction;
    const interval = Number(args[args.indexOf('--interval') + 1] || 10) * 1000;
    const cfx = await initCfxSdk(config.conflux);
    StatApp.networkId = cfx.networkId;
    console.log(`[epoch-checker] rpc networkId=${cfx.networkId}`);
    const sequelize = createDB({...config.database, readonly: true});
    // Register only the read models needed by this tool.  initModel() also
    // runs production schema migration helpers, which is deliberately avoided.
    KV.register(sequelize);
    Epoch.register(sequelize);
    Epoch.removeAttribute('id');
    Hex40Map.register(sequelize);
    FullBlock.register(sequelize);
    FullBlock.removeAttribute('id');
    FullTransaction.register(sequelize);
    FullTransaction.removeAttribute('id');
    CfxTransfer.register(sequelize);
    Erc20Transfer.register(sequelize);
    Erc721Transfer.register(sequelize);
    Erc1155Transfer.register(sequelize);
    AddressTransfer.register(sequelize);
    AddressTransfer.removeAttribute('id');
    EpochAddressIds.register(sequelize);
    EpochAddressIds.removeAttribute('id');
    NftTransfer.register(sequelize);
    AddressNftTransfer.register(sequelize);
    AddressNftTransfer.removeAttribute('id');
    ContractDestroy.register(sequelize);
    NameTag.register(sequelize);
    CensorItem.register(sequelize);
    VoteParams.register(sequelize);
    VoteParams.removeAttribute('id');
    const checker = new EpochDataChecker(cfx, config);
    const latest = await checker.latestFinalized();
    console.log(`[epoch-checker] latest finalized=${latest}`);
    await checker.initialize(latest);
    if (args.includes('--resume')) {
        const resume = args[args.indexOf('--resume') + 1] as Direction|'both';
        const store = new CursorStore();
        if (resume === 'forward' || resume === 'backward') await store.resume(resume);
        if (resume === 'both') await Promise.all([store.resume('forward'), store.resume('backward')]);
    }
    const once = args.includes('--once');
    if (args.includes('--stop')) { await setEnabled(false); return; }
    await setEnabled(true);
    if (!await acquireLease()) { console.log('[epoch-checker] another instance owns the lease; exiting'); return; }
    console.log('[epoch-checker] lease acquired');
    do {
        if (!await isEnabled()) { console.log('[epoch-checker] disabled by admin; stopping'); break; }
        if (!await renewLease()) { console.log('[epoch-checker] lease lost; stopping'); break; }
        const directions: Direction[] = direction === 'both' ? ['forward', 'backward'] : [direction];
        console.log(`[epoch-checker] checking ${directions.join(',')}`);
        await Promise.all(directions.map(async item => {
            try {
                await checker.run(item);
            } catch (error) {
                console.error(`[epoch-checker] ${item} failed`, error);
            }
        }));
        if (once) break;
        await new Promise(resolve => setTimeout(resolve, interval));
    } while (true);
    await releaseLease();
    console.log('[epoch-checker] stopped');
    await KV.sequelize.close();
}

run().catch(async error => {
    console.error(error);
    if (KV.sequelize) await KV.sequelize.close().catch(() => undefined);
    process.exitCode = 1;
});
