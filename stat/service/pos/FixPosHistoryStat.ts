import {PosBlock, PosDailyStat, PosReward} from "../../model/PoS";
import {calcDailyPosReward, PosDailyStatMix} from "./PosStat";
import {init} from "../tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
import {Op} from "sequelize";
import {PosQuery} from "./PosQuery";

async function fixDailyPosReward() {
    const {createdAt: firstDay} = await PosReward.findOne({order:[['id','asc']]})
    const today = new Date()
    while(firstDay <= today) {
        const {reward = 0, accountId:count} = await calcDailyPosReward(firstDay)
        const avgReward = BigInt(reward) / BigInt(count || 1)
        await PosDailyStat.update({
            totalReward: BigInt(reward), avgReward, rewardAccounts: count || 0
        }, {
            where: {statDay: firstDay,}
        })
        console.log(`fix daily reward for ${firstDay.toISOString()}, reward ${reward}`)
        firstDay.setDate(firstDay.getDate() + 1)
    }
    console.log(`done`)
    process.exit(0)
}
async function fixDailyStaking(cfx: Conflux) {
    const pb = await PosBlock.findOne({where: {height: 2}}); // height 1 has wrong time 1970

    let dt = pb.createdAt;
    dt.setHours(23, 59, 59, 999);
    const endT = new Date().getTime();

    while (dt.getTime() < endT) {
        const dtStr = dt.toISOString().slice(0, 10);
        const maxEpoch = await Epoch.findOne({where: {timestamp: {[Op.lte]: dt}}, order: [['timestamp', 'desc']]})
        const info = await cfx.getPoSEconomics(maxEpoch.epoch);
        const bean = await PosDailyStat.findOne({where: {statDay: dtStr}});
        if (bean) {
            if (bean.lockedVotes > 0) {
                // stat worked at that day.
                console.log(`lockedVotes > 0`, bean.createdAt.toISOString())
                break;
            }
            await PosDailyStat.update({stakingAmount: info.totalPosStakingTokens}, {
                where: {id: bean.id}
            });
        } else {
            await PosDailyStat.create({
                stakingAmount: info.totalPosStakingTokens, statDay: dt,
                lockedVotes: 0, epoch: maxEpoch.epoch,
            })
        }
        console.log(`reach date`, dt.toISOString(), info.totalPosStakingTokens)
        dt.setDate(dt.getDate()+1)
    }
    console.log(`done`)
}
async function fixDailyApy(cfx: Conflux) {
    const pb = await PosBlock.findOne({where: {height: 2}}); // height 1 has wrong time 1970

    let dt = pb.createdAt;
    dt.setHours(23, 59, 59, 999);
    const endT = new Date().getTime();

    while (dt.getTime() < endT) {
        const dtStr = dt.toISOString().slice(0, 10);
        const maxEpoch = await Epoch.findOne({where: {timestamp: {[Op.lte]: dt}}, order: [['timestamp', 'desc']]})
        const info = await PosQuery.calculateApy(cfx, maxEpoch.epoch);
        const bean = await PosDailyStatMix.findOne({where: {day: dtStr, biz: 'pos_apy'}});
        if (bean) {
            break;
        } else {
            await PosDailyStatMix.create({
                day: dt, v: info.apy,
                biz: 'pos_apy',
            })
        }
        console.log(`reach date`, dt.toISOString(), info.apy)
        dt.setDate(dt.getDate()+1)
    }
    console.log(`done`)
}
async function main() {
    const [,,cmd, param1] = process.argv
    const cfg = await init();
    if (cmd === 'fixDailyPosReward') {
        await fixDailyPosReward()
    } else if (cmd === 'fixDailyStaking') {
        cfg.conflux.url = "http://main.confluxrpc.com";
        if (param1 === "net1") {
            cfg.conflux.url = "http://test.confluxrpc.com";
        }
        console.log(`use rpc url`, cfg.conflux.url)
        const cfx = new Conflux(cfg.conflux);
        await fixDailyStaking(cfx)
    }
    console.log(`done`);
}

// node stat/service/pos/FixPosHistoryStat.js fixDailyStaking
if (module === require.main) {
    main().then()
}
