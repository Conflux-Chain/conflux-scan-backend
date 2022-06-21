import {PosDailyStat, PosReward} from "../../model/PoS";
import {calcDailyPosReward} from "./PosStat";
import {init} from "../tool/FixDailyTokenStat";

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
async function main() {
    const [,,cmd] = process.argv
    const cfg = await init();
    if (cmd === 'fixDailyPosReward') {
        await fixDailyPosReward()
    }
    console.log(`done`)
}

if (module === require.main) {
    main().then()
}