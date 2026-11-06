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
import {loadCheckerConfig} from './CheckerConfig';
import {EpochDataChecker, Direction} from './Checker';
import {CursorStore} from './CursorStore';
import {acquireLease, isEnabled, releaseLease, renewLease, setEnabled} from './Control';

async function run() {
    const config = loadCheckerConfig();
    const args = process.argv.slice(2);
    const direction = (args[args.indexOf('--direction') + 1] || 'both') as 'both'|Direction;
    const interval = Number(args[args.indexOf('--interval') + 1] || 10) * 1000;
    const cfx = await initCfxSdk(config.conflux);
    const sequelize = createDB({...config.database, readonly: true});
    // Register only the read models needed by this tool.  initModel() also
    // runs production schema migration helpers, which is deliberately avoided.
    KV.register(sequelize);
    Epoch.register(sequelize);
    Hex40Map.register(sequelize);
    FullBlock.register(sequelize);
    FullTransaction.register(sequelize);
    CfxTransfer.register(sequelize);
    Erc20Transfer.register(sequelize);
    Erc721Transfer.register(sequelize);
    Erc1155Transfer.register(sequelize);
    const checker = new EpochDataChecker(cfx, config);
    const latest = await checker.latestFinalized();
    await checker.initialize(latest);
    if (args.includes('--resume')) {
        const resume = args[args.indexOf('--resume') + 1] as Direction;
        if (resume === 'forward' || resume === 'backward') await (new CursorStore()).resume(resume);
    }
    const once = args.includes('--once');
    if (args.includes('--stop')) { await setEnabled(false); return; }
    await setEnabled(true);
    if (!await acquireLease()) { console.log('epoch data checker is already running on another machine'); return; }
    do {
        if (!await isEnabled() || !await renewLease()) break;
        const directions: Direction[] = direction === 'both' ? ['forward', 'backward'] : [direction];
        await Promise.all(directions.map(item => checker.run(item)));
        if (once) break;
        await new Promise(resolve => setTimeout(resolve, interval));
    } while (true);
    await releaseLease();
    await KV.sequelize.close();
}

run().catch(async error => {
    console.error(error);
    if (KV.sequelize) await KV.sequelize.close().catch(() => undefined);
    process.exitCode = 1;
});
