import {PosBlock, PosDailyStat, PosReward} from "../../model/PoS";
import {calcDailyPosReward} from "./PosStat";
import {init} from "../tool/FixDailyTokenStat";
import {Conflux} from "js-conflux-sdk";
import {Epoch} from "../../model/Epoch";
import {Op} from "sequelize";
import moment from "moment";

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
    const pb = await PosBlock.findOne({order:['height','asc'], raw: true});
    const firstStat = await PosDailyStat.findOne({order: [['statDay', 'asc']], raw: true})
    let dt = pb.createdAt;
    const endT = firstStat.statDay.getTime();
    while (dt.getTime() < endT) {
        const dtStr = moment(dt).format('YYYY.MM.DD');
        const maxEpoch = await Epoch.findOne({where: {timestamp: {[Op.lt]: dt}}, order: [['timestamp', 'desc']]})
        const info = await cfx.getPoSEconomics(maxEpoch.epoch);
        const bean = await PosDailyStat.findOne({where: {statDay: dtStr}});
        if (bean) {
            await PosDailyStat.update({stakingAmount: info.totalPosStakingTokens}, {
                where: {id: bean.id}
            })
        } else {
            await PosDailyStat.create({
                stakingAmount: info.totalPosStakingTokens, statDay: dt,
                lockedVotes: 0,
            })
        }
        console.log(`reach date`, dt.toISOString())
        dt.setDate(dt.getDate() + 1);
    }
    console.log(`done`)
}
async function main() {
    const [,,cmd] = process.argv
    const cfg = await init();
    if (cmd === 'fixDailyPosReward') {
        await fixDailyPosReward()
    } else if (cmd === 'fixDailyStaking') {
        const cfx = new Conflux(cfg.conflux);
        await fixDailyStaking(cfx)
    }
    console.log(`done`);
}

// node stat/service/pos/FixPosHistoryStat.js fixDailyStaking
if (module === require.main) {
    main().then()
}
