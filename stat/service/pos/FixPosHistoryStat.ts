import {PosBlock, PosDailyStat, PosEpochRewardHash, PosReward} from "../../model/PoS";
import {calcDailyPosReward, PosDailyStatMix} from "./PosStat";
import {init} from "../tool/FixDailyTokenStat";
import {Conflux, Drip} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
import {Op} from "sequelize";
import {PosQuery} from "./PosQuery";
import {fixPosRewardAll, fixRewardByEpoch} from "./FixPosReward";
import {initCfxSdk} from "../common/utils";

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
async function fixTotalReward() {
    // alter table pos_epoch_reward_hash add index idx_pow_dt (powDate);
    const pb = await PosBlock.findOne({where: {height: 2}}); // height 1 has wrong time 1970

    let dt = pb.createdAt;
    dt.setHours(23, 59, 59, 999);
    const endT = new Date().getTime();
    let total = BigInt(0);
    while (dt.getTime() < endT) {
        const bean = await PosDailyStatMix.findOne({where: {day:{[Op.eq]: dt}, biz: 'pos_total_reward'}});
        if (bean) {
            console.log(`exists ${bean.day}`)
        } else {
            const dayBegin = new Date(dt);
            dayBegin.setHours(0, 0, 0, 0)
            const sum = await PosEpochRewardHash.sum('drip', {
                where: {powDate: {[Op.between]: [dayBegin, dt]}}
            })
            total += BigInt(sum ?? 0);
            const newBean = await PosDailyStatMix.create({
                day: dt, biz: 'pos_total_reward',
                // @ts-ignore
                v: parseFloat(new Drip(total).toCFX()),
            })
            console.log(`reward at day `, dt.toISOString(), newBean.v);
        }
        dt.setDate(dt.getDate()+1)
    }
}
async function main() {
    const [,,cmd, param1] = process.argv
    const cfg = await init();
    if (cmd === 'fixDailyPosReward') {
        await fixDailyPosReward()
    } else if (cmd === 'fixReward') {
        const cfx = await initCfxSdk(cfg.conflux);
        await fixPosRewardAll(param1 ? parseInt(param1) : undefined, cfx, true);
    } else if (cmd === 'fixTotalReward') {
        await fixTotalReward();
    } else if (cmd === 'fixDailyStaking' || cmd === 'fixDailyApy') {
        cfg.conflux.url = "http://main.confluxrpc.com";
        if (param1 === "net1") {
            cfg.conflux.url = "http://test.confluxrpc.com";
        }
        console.log(`use rpc url`, cfg.conflux.url)
        const cfx = new Conflux(cfg.conflux);
        if (cmd === 'fixDailyApy') {
            await fixDailyApy(cfx);
        } else {
            await fixDailyStaking(cfx)
        }
    }
    console.log(`done`);
    return PosBlock.sequelize.close()
}
/*
 update pos_daily_stat set totalReward = ifnull(
    (select posReward*1e18 from daily_pos_reward_stat where statType='1d' and statTime=statDay)
   ,0) where totalReward = 0;
 update pos_daily_stat set rewardAccounts =
    (select count(distinct(accountId)) from pos_reward where createdAt >= statDay and createdAt < date_add(statDay, interval 1 day) )
     where rewardAccounts = 0;
 update pos_daily_stat set avgReward =   totalReward /   rewardAccounts where avgReward=0 and rewardAccounts > 0 ;

 alter table pos_gap add index idx_dt(createdAt);

 insert into pos_daily_stat_mix (day, v, biz, createdAt, updatedAt)
    select date(createdAt) as day, avg(epochGap), 'finalize_epoch_gap', now(), now() from pos_gap where createdAt < '2024-03-06' group by day;
update  pos_daily_stat_mix set v=(select epochGap from pos_gap where createdAt > day and createdAt < date_add(day, interval 1 hour) limit 1 )
where day<'2024-03-06' and biz='finalize_epoch_gap';

 insert into pos_daily_stat_mix (day, v, biz, createdAt, updatedAt)
    select date(createdAt) as day, avg(secondsGap), 'finalize_second_gap', now(), now() from pos_gap where createdAt < '2024-03-06' group by day;
update  pos_daily_stat_mix set v=(select secondsGap from pos_gap where createdAt > day and createdAt < date_add(day, interval 1 hour) limit 1 )
where day<'2024-03-06' and biz='finalize_second_gap';

*/
// node stat/service/pos/FixPosHistoryStat.js fixDailyStaking
// node stat/service/pos/FixPosHistoryStat.js fixDailyApy
// node stat/service/pos/FixPosHistoryStat.js fixTotalReward
// node stat/service/pos/FixPosHistoryStat.js fixReward | tee pos-reward.2025.2.17.log
if (module === require.main) {
    main().then()
}
