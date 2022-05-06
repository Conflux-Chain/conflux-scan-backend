import {Conflux, Drip} from "js-conflux-sdk";
import {PosAccount, PosAccountBlock, PosBlock, PosCommittee, PosGap} from "../../model/PoS";
import {DataTypes, Model, QueryTypes, Sequelize, Op, fn, col, literal} from 'sequelize'
import {PosQuery} from "./PosQuery";
import {KV, TOTAL_POS_REWARD} from "../../model/KV";
import {Epoch} from "../../model/Epoch";
import {init} from "../tool/FixDailyTokenStat";
import {CfxTransfer} from "../../model/CfxTransfer";
import {makeIdV} from "../../model/HexMap";

export interface IPosDailyStatMix {
    id?:number; day:Date; v:number; biz: BIZ
}
export declare type BIZ = 'account_count' | 'finalize_epoch_gap' | 'finalize_second_gap'
    | 'pos_staking' | 'pos_apy' | 'pos_total_reward' | 'staking_deposit' | 'staking_withdraw' | 'participation_rate'
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
export async function syncFinalizeGap() {
    const maxGapBean = await PosGap.findOne({order: [['height','desc']]})
    let maxGapHeight = maxGapBean?.height || 1 // pos block 1 is root block, without useful information
    const posBlock = await PosBlock.findOne({where:{height: maxGapHeight + 1}})
    if (posBlock === null) {
        return 0
    }
    const {pivotDecision, createdAt, height} = posBlock
    const [powEpochAtThatTime, finalizedEpoch] = await Promise.all([
        Epoch.findOne({where: {
            timestamp: {[Op.lte]: createdAt}, epoch: {[Op.between]:[pivotDecision, pivotDecision+2_000]},
            }, order: [['epoch', 'desc']],
            // logging: console.log, benchmark: true
        }),
        Epoch.findOne({where:{epoch: pivotDecision}})
    ])
    if (powEpochAtThatTime === null) {
        console.log(`powEpochAtThatTime not found , want before time ${createdAt.toISOString()
        }, pos block height ${height} , pivotDecision ${pivotDecision
        }, finalizedEpoch time ${finalizedEpoch.timestamp.toISOString()}`)
        if (process.argv.includes('skip')){// 8888 hits it
            await PosGap.upsert({height: posBlock.height, powEpoch: pivotDecision, secondsGap:0, epochGap:0,
            createdAt: posBlock.createdAt})
            return 1
        }
        return 0
    }
    const secondsGap = Math.round((createdAt.getTime() - finalizedEpoch.timestamp.getTime())/1000)
    await PosGap.upsert({height: posBlock.height, epochGap: powEpochAtThatTime.epoch - pivotDecision,
        secondsGap, powEpoch: powEpochAtThatTime.epoch, createdAt})
    if (height % 100 === 0) {
        console.log(`pos gap at height `, height)
    }
    return 1
}
export async function scheduleSyncPosGap() {
    async function repeat() {
        const have = await syncFinalizeGap()
        setTimeout(repeat, have ? 0 : 50_000)
    }
    repeat().then()
}
export async function fixDailyPosAccountCount() {
    const startAtDay = await PosAccount.findOne({order:[['id','asc']]})
    if (!startAtDay) {
        console.log(`base block not found`)
        return
    }
    const {createdAt} = startAtDay
    let begin = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate()
        ,23,59,59)
    while (begin.getTime() < Date.now()) {
        const cnt = await PosAccount.count({where: {
            createdAt: {[Op.lte]: begin}
            }})
        await PosDailyStatMix.upsert({v: cnt, day: begin, biz: "account_count"})
        console.log(`${begin.toISOString()} account count`, cnt)
        begin.setDate(begin.getDate()+1)
    }
    console.log(`done`)
}

//======
async function scheduleDaily(fn:(dt: Date)=>Promise<void>) {
    async function repeat() {
        const now = new Date()
        await fn(now)
        if (now.getUTCHours() === 0 && now.getUTCMinutes() < 30) {
            now.setDate(now.getDate()-1)// previous day
            await fn(now)
        }
    }
    repeat().then(()=>{
        setInterval(repeat, 600_000)// 10 minutes
    })
}
//======
export async function scheduleDailyParticipation(){
    return scheduleDaily(calcDailyParticipation)
}
async function calcDailyParticipation(dt:Date) {
    const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59)
    const blockRange = await PosBlock.findOne({
        attributes:[
            [fn('min', col('height')), 'minHeight'],
            [fn('max', col('height')), 'maxHeight'],
            [fn('min', col('epoch')), 'minEpoch'],
            [fn('max', col('epoch')), 'maxEpoch'],
        ], raw: true,
        where: {createdAt: {[Op.between]:[dayStart, dayEnd]}},
        // logging: console.log, benchmark: true,
    })
    //
    const {minHeight, maxHeight, minEpoch, maxEpoch} = blockRange as any
    const votes = await PosAccountBlock.sum('votes', {where: {blockNumber: {[Op.between]:[minHeight, maxHeight]}},
        // logging: console.log, benchmark: true,
    })
    const [pos_committee, pos_block] = [PosCommittee.getTableName(), PosBlock.getTableName()]
    const sql = `select sum(m.totalVotingPower * t.cnt) as v from ${pos_committee} m join (
 select count(*) as cnt, epoch from ${pos_block} where createdAt BETWEEN ? AND ? group by epoch) t
 on t.epoch = m.epochNumber`
    const shouldVotes = await PosCommittee.sequelize.query(sql,
        {type: QueryTypes.SELECT, replacements: [dayStart, dayEnd], raw: true,
            // logging: console.log, benchmark: true,
        })
        .then(res=>{
            // console.log('result is', res, typeof res[0]['v'])
            return Number(res[0]['v'])
        })
    //
    let rate = votes/shouldVotes * 100;
    await PosDailyStatMix.upsert({
        v: rate, biz: 'participation_rate', day: dayStart,
    })
    console.log(` participation_rate ${dayStart.toISOString()} ${votes} / ${shouldVotes} = ${rate}`)
}
//======
export async function scheduleDailyStakingDepositWithdraw(){
    return scheduleDaily(calcDailyStaking)
}
let stakingAddrId = 0
let FCCFX = 0
async function calcDailyStaking(dt: Date) {
    if (!stakingAddrId) {
        stakingAddrId = await makeIdV('0x0888000000000000000000000000000000000002')
        FCCFX = await makeIdV('0x86d1f0072e8aa1a38d34b4bfa7521cdb5293849f') // net1029. do not care net 1
        console.log(`stakingAddrId `, stakingAddrId)
    }
    const dayStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59)
    const sumList = await CfxTransfer.findAll({
        attributes:[
            [fn('sum', col('value')), 'value'],
            // [fn('count', col('*')), 'count'],
            [literal('IF(fromId=?, "withdraw", "deposit")'), 'biz_type'],
        ],
        where: {[Op.and]:[
                {createdAt: {[Op.between]: [dayStart, dayEnd]}},
                {[Op.or]:[{fromId: stakingAddrId}, {toId: stakingAddrId}]},
                {fromId:{[Op.ne]: FCCFX}},
                {toId:{[Op.ne]: FCCFX}},
            ]},
        group: ['biz_type'], raw: true,
        replacements:[stakingAddrId],
        // logging: console.log, benchmark: true
    })
    const typeSet = new Set(['staking_deposit', 'staking_withdraw'])
    for(const row of sumList) {
        let biz = (row['biz_type'] === 'deposit' ? 'staking_deposit': "staking_withdraw") as BIZ;
        let unit = parseFloat(new Drip(row['value']).toCFX());
        await PosDailyStatMix.upsert({
            day: dt, biz: biz,
            v: unit,
        })
        typeSet.delete(biz)
        console.log(`${dt.toISOString()} ${biz}`, unit)
    }
    for(const type of typeSet) {
        await PosDailyStatMix.upsert({
            day: dt, biz: type as BIZ,
            v: 0,
        })
        console.log(`${dt.toISOString()} ${type}`, 0)
    }
}
//======
async function main() {
    const [,,cmd] = process.argv
    if (cmd === 'testGap') {
        await init()
        while(await syncFinalizeGap());
        console.log('pos gap count', await PosGap.count())
    } else if (cmd === 'calcDailyVoting') {
        await init()
        let dt = new Date('2022-01-24')
        while (dt.getTime() < Date.now()) {
            await calcDailyParticipation(dt)
            dt.setDate(dt.getDate() + 1)
        }
        console.log(`done`)
    } else if (cmd === 'calcDailyStaking') {
        await init()
        // await calcDailyStaking(new Date('2022-04-29'))
        // await calcDailyStaking(new Date('2022-02-23'))
        let dt = new Date('2020-10-29')
        while (dt.getTime() < Date.now()) {
            await calcDailyStaking(dt)
            dt.setDate(dt.getDate() + 1)
        }
        console.log(`done`)
    }
    // let url = ''
    // url = 'https://main.confluxrpc.com'
    // const cfx = new Conflux({url})
    // const svc = new PosStat(cfx)
    // await svc.updateFinalizeGap()
    // await svc.updatePosStaking()
    // await svc.updateApy()
}
if (module === require.main) {
    main().then()
}