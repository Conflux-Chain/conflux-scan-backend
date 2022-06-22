import {col, DataTypes, QueryTypes, fn, literal, Model, Op, Sequelize} from 'sequelize'
import {PosAccount, PosReward} from "../../model/PoS";
import {InvalidParamError, list2map} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";

export interface IPosRewardRank {
    id?:number; accountId:number; day1:bigint; day7: bigint; day14:bigint; day30:bigint;
    createdAt?:Date;
}
export class PosRewardRank extends Model<IPosRewardRank> implements IPosRewardRank {
    id?:number; accountId:number; day1:bigint; day7: bigint; day14:bigint; day30:bigint;
    createdAt:Date;
    static register(seq:Sequelize) {
        PosRewardRank.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), autoIncrement: true, primaryKey: true},
            accountId: {type: DataTypes.BIGINT({unsigned: true}), },
            day1: {type: DataTypes.DECIMAL(65, 0)},
            day7: {type: DataTypes.DECIMAL(65, 0)},
            day14: {type: DataTypes.DECIMAL(65, 0)},
            day30: {type: DataTypes.DECIMAL(65, 0)},
        }, {
            sequelize: seq, tableName: 'pos_reward_rank',
            indexes: [
                {name: 'idx_dt_day1', fields: ['createdAt', 'day1']},
                {name: 'idx_dt_day7', fields: ['createdAt', 'day7']},
                {name: 'idx_dt_day14', fields: ['createdAt', 'day14']},
                {name: 'idx_dt_day30', fields: ['createdAt', 'day30']},
            ]
        })
    }
}
export async function buildPosRewardRank() {
    const day30list = await queryPosRewardDayN(30)
    const day14list = await queryPosRewardDayN(14)
    const day7list = await queryPosRewardDayN(7)
    const day1list = await queryPosRewardDayN(1)
    //
    const now = new Date()
    const zero = BigInt(0)
    function makeEntry({accountId}, fn:(entry:IPosRewardRank)=>{}) {
        const entry = {accountId: accountId, createdAt: now, day1: zero, day14: zero, day30: zero, day7: zero};
        fn(entry)
        return entry
    }
    const map = new Map<number, IPosRewardRank>()
    // put each entry in the list to the map
    function convert(list:PosReward[], key:string) {
        list.forEach(acc => {
            let entry = map.get(acc.accountId)
            if (entry) {
                entry[key] = BigInt(acc.reward)
                return
            }
            // build an entry if absent
            entry = makeEntry(acc, entry => entry[key] = BigInt(acc.reward))
            map.set(acc.accountId, entry)
        })
    }
    const data = {day30:day30list, day14:day14list, day7:day7list, day1:day1list};
    ['day30', 'day14', 'day7', 'day1'].forEach(key=>{
        convert(data[key], key)
    })
    await PosRewardRank.bulkCreate([...map.values()])
    await PosRewardRank.destroy({
        where: {createdAt: {[Op.lt]: now}}
    })
    console.log(` build pos rank at ${now.toISOString()}, entry count ${map.size}`)
}
export type POS_RANK_FIELD = 'day1' | 'day7' | 'day14' | 'day30' | 'all'
export async function queryPosRank(rankField: POS_RANK_FIELD, order:'desc'|'asc', skip:number, limit: number) {
    const max = await PosRewardRank.findOne({order:[['createdAt','desc']]})
    if (!max) {
        return {total: 0, list: []}
    }
    if (/day(1|7|14|30)$/.test(rankField)) {
        // query from rank table
        const {count, rows:rankList} = await PosRewardRank.findAndCountAll({
            where: {createdAt:max.createdAt},
            order: [[rankField, order]],
            offset:skip, limit, raw:true
        })
        // query related account info
        const accountList = await PosAccount.findAll({
            where: {id: {[Op.in]: rankList.map(row=>row.accountId)}}
        })
        const map = list2map(accountList, 'accountId')
        // fill account info
        rankList.forEach(row=>{
            row["accountInfo"] = map.get(row.accountId)
        })
        return {total: count, list: rankList}
    } else if ('all' === rankField) {
        // order by total reward, query from account table
        const {count, rows:accountList} = await PosAccount.findAndCountAll({
            order: [['totalReward',order]], raw: true, offset: skip, limit,
        })
        // query related rank info
        const rankList = await PosRewardRank.findAll({
            where: {createdAt: max.createdAt, accountId:{[Op.in]: accountList.map(acc=>acc.id)}}
        })
        const rankMap = list2map(rankList, 'accountId')
        const zero = BigInt(0)
        // convert
        const resultList = accountList.map(acc=>{
            let rankBean = rankMap.get(acc.id)
            if (!rankBean) {
                rankBean =  {accountId: acc.id, createdAt: acc.createdAt, day1: zero, day14: zero, day30: zero, day7: zero};
            }
            rankBean['accountInfo'] = acc;
            return rankBean
        })
        return {total: count, list: resultList}
    }
    throw new InvalidParamError(`invalid parameter, rank by [${rankField}]`)
}
export async function queryPosRewardDayN(n:number) {
    let daysAgo = new Date()
    daysAgo.setDate(daysAgo.getDate() - n)
    // fetch account within N days
    return queryPosReward(daysAgo)
}
async function queryPosReward(earliestDate:Date) {
    return PosReward.findAll({
        attributes: [
            'accountId',
            [literal('sum(reward)'), 'reward'],
        ],
        where: {createdAt: {[Op.gt]: earliestDate}},
        group: 'accountId'
    })
}
async function main() {
    const [,,cmd] = process.argv
    await init();
    if (cmd === 'buildRank') {
        await buildPosRewardRank()
    } else if (cmd === 'testQuery') {
        const [,,_,rankField,order] = process.argv
        await queryPosRank(rankField as any, order as any, 0, 10).then(res=>{
            console.log(`result `, JSON.stringify(res, null, 4))
        })
    }
    process.exit(0)
    console.log(`done`)
}
if (module === require.main) {
    main().then()
}