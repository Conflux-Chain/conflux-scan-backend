import {Conflux, Drip} from "js-conflux-sdk";
import {PosAccount, PosBlock} from "../../model/PoS";
import {DataTypes, Model, Sequelize, Op, fn, col} from 'sequelize'
import {PosQuery} from "./PosQuery";
import {KV, TOTAL_POS_REWARD} from "../../model/KV";

export interface IPosDailyStatMix {
    id?:number; day:Date; v:number; biz: BIZ
}
declare type BIZ = 'account_count' | 'finalize_epoch_gap' | 'finalize_second_gap'
    | 'pos_staking' | 'pos_apy' | 'pos_total_reward'
export class PosDailyStatMix extends Model<IPosDailyStatMix> implements IPosDailyStatMix{
    id?:number; day:Date; v:number; biz: BIZ
    static register(seq:Sequelize) {
        PosDailyStatMix.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            day: {type: DataTypes.DATEONLY},
            v: {type: DataTypes.DECIMAL(65, 18)},
            biz: {type: DataTypes.STRING(64)},
        }, {
            sequelize: seq, tableName: 'pos_daily_stat_mix',
            indexes:[
                {name:'uk_biz_day', fields: ['biz', 'day'], unique: true}
            ]
        })
    }
}
export class PosStat {
    cfx:Conflux
    posQuery: PosQuery
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.posQuery = new PosQuery(cfx)
    }
    async update() {
        await this.updateAccountCount();
        await this.updateFinalizeGap();
        await this.updatePosStaking()
        await this.updateApy()
        await this.updateTotalReward()
        // await this.

    }
    async updateTotalReward() {
        const drip = await KV.getString(TOTAL_POS_REWARD, "0")
        await PosDailyStatMix.upsert({
            day: new Date(),
            // @ts-ignore
            v: parseFloat(new Drip(drip).toCFX()),
            biz: 'pos_total_reward'
        })
    }
    async updateApy() {
        const {apy} = await this.posQuery.calculateApy()
        console.log('apy',apy)
        await PosDailyStatMix.upsert({
            day: new Date(), v: apy, biz: 'pos_apy'
        })
    }
    async updatePosStaking() {
        const posE = await this.cfx.getPoSEconomics()
        console.log(`posE`, posE)
        await PosDailyStatMix.upsert({
            day: new Date(), v: parseFloat(new Drip(posE.totalPosStakingTokens).toCFX()), biz: 'pos_staking'
        })
    }
    async updateAccountCount() {
        const cnt = await PosAccount.count({})
        await PosDailyStatMix.upsert({
            day: new Date(), v: cnt, biz: "account_count"
        })
    }
    async updateFinalizeGap() {
        // const posSt = await this.cfx.pos.getStatus()
        const powSt = await this.cfx.getStatus()
        // console.log(`pos st`, posSt)
        // console.log(`pow st`, powSt)
        //
        // @ts-ignore
        const epochGap = powSt.latestState - powSt.latestFinalized
        const powBlockDecision = await this.cfx.getBlockByEpochNumber(powSt["latestFinalized"])
        const powBlockState = await this.cfx.getBlockByEpochNumber(powSt.latestState)
        const secondGap2 = powBlockState.timestamp - powBlockDecision.timestamp
        console.log(`epoch gap ${epochGap}, gap sec by block ${secondGap2}`)
        await PosDailyStatMix.upsert({
            day: new Date(), v: epochGap, biz: "finalize_epoch_gap"
        })
        await PosDailyStatMix.upsert({
            day: new Date(), v: secondGap2, biz: "finalize_second_gap"
        })
    }
}
export async function scheduleDailyStatMix(cfx:Conflux) {
    const svc = new PosStat(cfx)
    setInterval(()=>{
        svc.update().catch(err=>{
            console.log(`DailyStatMix fail`, err)
        })
        }, 60_000
    );
}
export async function fixDailyPosAccountCount() {
    const startAtDay = await PosAccount.findOne({order:[['id','asc']]})
    if (!startAtDay) {
        console.log(`base block not found`)
        return
    }
    const {createdAt} = startAtDay
    let begin = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate()
        ,23,59,99)
    while (begin.getTime() < Date.now()) {
        const cnt = await PosBlock.count({where: {
            createdAt: {[Op.lt]: begin}
            }})
        await PosDailyStatMix.upsert({v: cnt, day: begin, biz: "account_count"})
        console.log(`${begin.toISOString()} account count`, cnt)
        begin.setDate(begin.getDate()+1)
    }
    console.log(`done`)
}
async function main() {
    const [,,cmd] = process.argv
    let url = ''
    url = 'https://main.confluxrpc.com'
    const cfx = new Conflux({url})
    const svc = new PosStat(cfx)
    // await svc.updateFinalizeGap()
    // await svc.updatePosStaking()
    // await svc.updateApy()
}
if (module === require.main) {
    main().then()
}