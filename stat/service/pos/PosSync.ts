import {Conflux} from "js-conflux-sdk";
import {sleep} from "../tool/ProcessTool";
import {IPosAccountBlock, PosAccount, PosAccountBlock, PosBlock} from "../../model/PoS";
import {init} from "../tool/FixDailyTokenStat";
import {QueryTypes} from "sequelize";

export class PosSync {
    private cfx: Conflux;
    private position: number;
    private latestBlockNumber: 0;
    constructor(cfx: Conflux) {
        this.cfx = cfx;
    }
    async init() {
        const max = await PosBlock.max('height')
        this.position = isNaN(Number(max)) ? 1 : Number(max) + 1
        console.log(` db max is ${max}, next position is `, this.position)
    }
    async updateLatestBlockNumber() {
        const st = await this.cfx["pos"].getStatus()
        this.latestBlockNumber = st.blockNumber;
        console.log(` update latestBlockNumber to ${this.latestBlockNumber}`)
    }
    async run() {
        if (this.position < this.latestBlockNumber) {
            const code = await this.sync(this.position)
            this.position += 1
            setTimeout(()=>this.run(), 0)
        } else {
            await sleep(5_000)
            await this.updateLatestBlockNumber()
            setTimeout(()=>this.run(), 0)
        }
    }
    async sync(blockNumber) {
        const blockDetail = await this.cfx["pos"].getBlockByNumber(blockNumber)
        let minerId = null
        if (blockDetail.miner) {
            minerId = await this.saveAccount(blockDetail.miner)
        }
        const map = new Map<string, number>()
        const accountBlockBeans:IPosAccountBlock[] = []
        const accountIds = []
        for (const s of blockDetail.signatures) {
            const id = await this.saveAccount(s.account)
            map.set(s.account, id)
            accountBlockBeans.push({accountId: id, blockNumber, id: null})
            accountIds.push(id)
        }
        await PosAccountBlock.sequelize.transaction(async tx=>{
            await Promise.all([
                PosBlock.create({
                    createdAt: new Date(blockDetail.timestamp/1000),
                    epoch: blockDetail.epoch,
                    hash: blockDetail.hash,
                    height: blockDetail.height,
                    minerId: minerId,
                    parentHash: blockDetail.parentHash?.substr(2,4),
                    pivotDecision: blockDetail.pivotDecision,
                    round: Number.isInteger(blockDetail.round) ? blockDetail.round : Number.parseInt(blockDetail.round, 16),
                    timestamp: blockDetail.timestamp,
                    transactionCount: blockDetail.transactions?.length || 0,
                    version: blockDetail.version,
                    signatureCount: blockDetail.signatures?.length || 0,
                }, {transaction: tx}).catch(err=>{
                    console.log(` save to db fail, data:`, blockDetail)
                    throw err
                }),
                PosAccountBlock.bulkCreate(accountBlockBeans, {transaction: tx}),
                new Promise((resolve, reject) => {
                    if (!accountIds.length) {
                        resolve(0)
                        return
                    }
                    PosAccount.sequelize.query(
                        `update pos_account set signCount = signCount + 1 where id in (${accountIds.join(',')})`,{
                            transaction: tx, type: QueryTypes.UPDATE
                        }).then(()=>{
                        return minerId ? PosAccount.sequelize.query(
                            `update pos_account set mineCount = mineCount + 1 where id = ${minerId}`,{
                                transaction: tx, type: QueryTypes.UPDATE
                            }) : undefined
                    }).then(resolve).catch(reject)
                }),
            ])
        })

        // console.log(`pos sync block:`, blockDetail)
        console.log(`pos sync block:`, blockNumber)
    }
    async saveAccount(hex:string) {
        return PosAccount.make(hex)
    }
}
if (require.main === module) {
    const args = process.argv.slice(2)
    const url = args[0]
    const cfx = new Conflux({url})
    const posSync = new PosSync(cfx);
    init().then(()=> {
        return posSync.init()
    }).then(()=>{
        return posSync.updateLatestBlockNumber()
    }).then(()=>{
        // posSync.sync(2).then()
        cfx['pos'].getBlockByNumber(153).then(res=>{
            // console.log(` pos block `, res)
        })
        // cfx['pos'].getAccount('0x867d88952f32f19a965282d5d60f89b9bb384a1b0f414180d093c3edc3f9d055').then(console.log)
        return posSync.run()
    })
}