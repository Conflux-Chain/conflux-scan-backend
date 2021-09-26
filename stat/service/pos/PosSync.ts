import {Conflux} from "js-conflux-sdk";
import {sleep} from "../tool/ProcessTool";
import {
    IPosAccountBlock,
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee,
    PosCommitteeNode,
    PosTransaction
} from "../../model/PoS";
import {init} from "../tool/FixDailyTokenStat";
import {json, QueryTypes} from "sequelize";
// import {abi as posAbi} from "../abi/PosRegister"
const {abi: posAbi} = require("../abi/PoSRegister")

export class PosSync {
    private cfx: Conflux;
    private position: number;
    private latestBlockNumber: 0;
    private posContract: any;
    constructor(cfx: Conflux) {
        this.cfx = cfx;
    }
    async init() {
        await this.cfx.updateNetworkId();
        const max = await PosBlock.max('height')
        this.position = isNaN(Number(max)) ? 1 : Number(max) + 1
        console.log(` db max is ${max}, next position is `, this.position)
        const posContractAddr = '0x0888000000000000000000000000000000000005'
        this.posContract = this.cfx.Contract({abi:posAbi, address: posContractAddr})
    }
    async updateLatestBlockNumber() {
        const st = await this.cfx["pos"].getStatus()
        // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
        console.log(` status : ${JSON.stringify(st)}`)
        this.latestBlockNumber = st.latestVoted;
        console.log(` update latestBlockNumber to ${this.latestBlockNumber}`)
    }
    async run() {
        // syn block thread.
        if (this.position < this.latestBlockNumber) {
            let error = false
            await this.syncBlock(this.position).catch(err=>{
                console.log(` error at ${this.position} , ${err.message}`)
                error = true
            })
            if (!error) {
                this.position += 1
            }
            setTimeout(()=>this.run(), error ? 10_000 : 0)
        } else {
            await sleep(5_000)
            await this.updateLatestBlockNumber()
            setTimeout(()=>this.run(), 0)
        }
    }
    async syncBlock(blockNumber) {
        const blockDetail = await this.cfx["pos"].getBlockByNumber(blockNumber)
        if (blockDetail === null) {
            throw new Error(`block detail is null, ${blockNumber}`)
        }
        let minerId = null;
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
    async saveAccount(hex:string) : Promise<number> {
        return PosAccount.make(hex, (id)=>{
            // console.log(` callback after account created.`)
            return this.patchCreatedAccount(id, hex).then(()=>{
                return id
            })
        }).then(id=>{
            // console.log(` save account , got id ${id}`)
            return id;
        })
    }
    async patchCreatedAccount(id, hex) {
        const info = await this.posContract.identifierToAddress(hex)
        // console.log(` identifierToAddress ${hex}, got `, info)
        return PosAccount.update({powBase32: info}, {
            where: {id: id}
        }).then(()=>{
            return id
        })
    }
    // =======
    repeatFetchCommittee() {
        const that = this
        function repeat() {
            that.syncCommittee().then(()=>{
                setTimeout(()=>repeat(), 10_000)
            })
        }
        repeat()
    }
    async syncCommittee() {
        const [status, next] = await Promise.all([
            this.cfx["pos"].getStatus(),
            PosCommittee.max('blockNumber').then(res=>{
                return Number.isNaN(res) ? 1 : (Number(res) + 1)
            }),
        ])
        let cursor = next;
        while(cursor < status.latestCommitted) {
            await this.syncCommitteeByBlockNumber(cursor);
            cursor += 1
        }
        console.log(` Done for this round, start at ${next}`)
    }

    private async syncCommitteeByBlockNumber(cursor: number) {
        const rpcResult = await this.getCommittee(cursor);
        if (this.NOT_FOUND_COMMITTEE === rpcResult) {
            return
        }
        const {currentCommittee} = rpcResult;
        // make account id
        for (const n of currentCommittee.nodes) {
            n.accountId = await this.saveAccount(n.address)
        }
        // save to db
        await PosCommittee.sequelize.transaction(async (dbTx) => {
            return Promise.all([
                PosCommittee.create({
                    ...currentCommittee, blockNumber: cursor, nodesCount: currentCommittee.nodes.length,
                }, {transaction: dbTx}),
                PosCommitteeNode.bulkCreate(currentCommittee.nodes.map(n => {
                    // console.log(` node is ${JSON.stringify(n)}`)
                    return {
                        ...n, epochNumber: currentCommittee.epochNumber, blockNumber: cursor,
                    }
                }, {transaction: dbTx}))
            ])
        })
        console.log(` save committee, block number ${cursor}, nodes count ${currentCommittee.nodes.length}`)
    }
    readonly NOT_FOUND_COMMITTEE = {}
    async getCommittee(blockNumber: number) {
        // const info = await this.cfx["pos"].getCommittee(undefined)
        const info = await this.cfx["pos"].getCommittee(blockNumber).catch(err=>{
            if (/PoS state of \d+ not found/.test(err.message)) {
                // console.log(` It's ok. ${err.message}`);
                return this.NOT_FOUND_COMMITTEE
            }
            throw err
        })
        // console.log(` committee info of block number ${blockNumber.toString().padStart(8, ' ')}: `, JSON.stringify(info, ))
        return info
    }
    async repeatSyncTx() {
        let next = await PosTransaction.max('number').then(res=>{
            return Number.isNaN(res) ? 1 : (Number(res) + 1)
        })
        const that = this
        async function repeat() {
            const tx = await that.cfx['pos'].getTransactionByNumber(next)
            if (tx === null) {
                setTimeout(repeat, 10_000)
            } else {
                const accountId = await that.saveAccount(tx.from)
                await PosTransaction.create({
                    blockNumber: 0, // FIXME
                    fromId: accountId, number: next, status: tx.status, type: tx.type
                })
                console.log(` save tx ${next}`)
                next += 1
                setTimeout(repeat, 0)
            }
        }
        repeat().then()
    }
    async test() {
        console.log(`===================== pos test ========`)
        // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
        const st = await this.cfx["pos"].getStatus()
        console.log(` status ${JSON.stringify(st)}`)
        // await this.getCommittee(st.latestCommitted).catch(console.log)
        // await this.getCommittee(1).catch(console.log)
        // await this.getCommittee(st.latestVoted).catch(console.log)
        // await this.getCommittee(st.pivotDecision).catch(console.log)
        // await this.syncCommittee()
        await this.repeatSyncTx()
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
        // cfx['pos'].getBlockByNumber(153).then(res=>{
            // console.log(` pos block `, res)
        // })
        // return posSync.test()
        // cfx['pos'].getAccount('0x867d88952f32f19a965282d5d60f89b9bb384a1b0f414180d093c3edc3f9d055').then(console.log)
        // posSync.patchCreatedAccount(0, '0x867d88952f32f19a965282d5d60f89b9bb384a1b0f414180d093c3edc3f9d055')

        return Promise.all([
            posSync.run(),
            posSync.repeatFetchCommittee(),
            posSync.repeatSyncTx(),
        ])
    }).then(()=>{

    })
}