import {Conflux} from "js-conflux-sdk";
import {sleep} from "../tool/ProcessTool";
import {
    IPosAccountBlock, IPosReward,
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee,
    PosCommitteeNode, PosReward,
    PosTransaction
} from "../../model/PoS";
import {init} from "../tool/FixDailyTokenStat";
import {fn, col, Op, QueryTypes} from "sequelize";
import {PosQuery} from "./PosQuery";
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
        console.log(`PosBlock db max is ${max}, next position is `, this.position)
        const posContractAddr = '0x0888000000000000000000000000000000000005'
        this.posContract = this.cfx.Contract({abi:posAbi, address: posContractAddr})
    }
    async updateLatestBlockNumber() {
        let st: Object;
        try {
            st = await this.cfx["pos"].getStatus();
        } catch (e) {
            console.log(` get status fail:`, e)
            return
        }
        // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
        // console.log(` status : ${JSON.stringify(st)}`)
        this.latestBlockNumber = st["latestVoted"];
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
        async function repeat() {
            try {
                await that.syncCommittee()
            }catch(e){
                console.log(` pos syncCommittee fail:`, e)
            }
            setTimeout(()=>repeat(), 10_000)
        }
        repeat().then()
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
            const tx = await that.cfx['pos'].getTransactionByNumber(next).catch(err=>{
                console.log(` getTransactionByNumber fail, ${next}:`, err)
                return null
            })
            if (tx === null) {
                setTimeout(repeat, 10_000)
            } else {
                const accountId = await that.saveAccount(tx.from)
                const dt = new Date(tx.timestamp/1000)
                await PosTransaction.create({
                    blockNumber: 0, // FIXME
                    fromId: accountId, number: next, status: tx.status, type: tx.type,
                    createdAt: dt,
                })
                console.log(` save tx ${next}`)
                next += 1
                setTimeout(repeat, 0)
            }
        }
        repeat().then()
    }
    async repeatSyncRewards(rewardStartAt: number) {
        const rewardStartAtPos = await this.computeRewardStartAt(rewardStartAt)
        const that = this
        let nextEpoch = await PosReward.findOne({order:[['id','desc']]}).then(res=>{
            return res === null ? rewardStartAtPos : res.epoch + 1
        })
        async function repeat() {
            try {
                const inc = await that.syncRewardByEpoch(nextEpoch)
                nextEpoch += inc
            } catch (e) {
                console.log(` error sync pos reward at epoch ${nextEpoch}:`, e)
                await sleep(5_000)
            }
            setTimeout(repeat, 0)
        }
        repeat().then()
    }
    async syncRewardByEpoch(epoch:number) {
        const rewardInfo = await this.cfx['pos'].getRewardsByEpoch(epoch)
        if (rewardInfo === null) {
            console.log(` reward is null at epoch ${epoch}`)
            await sleep(5_000)
            return 0
        }
        const accountRewards = rewardInfo.accountRewards;
        const posAddrArr = accountRewards.map(r=>r.posAddress)
        const accounts = await PosAccount.findAll({
            attributes: ['id','hex'],
            where: {hex: {[Op.in]:posAddrArr}}
        })
        const accountMap = new Map<string, PosAccount>()
        accounts.forEach(a=>accountMap.set(a.hex, a))
        if (posAddrArr.length !== accounts.length) {
            console.log(` account absent, want ${posAddrArr.join(',')}\n actual ${accounts.map(a=>a.hex).join(',')}`)
            await sleep(5_000)
            return 0
        }
        const rewardBeans:IPosReward[] = accountRewards.map(r=>{
            const account = accountMap.get(r.posAddress);
            if (!account) {
                throw new Error(`account not found, pos addr ${r.posAddress}, \n in ${JSON.stringify(accounts)}`)
            }
            const accountId = account.id;
            return {
                accountId: accountId,
                reward: r.reward,
                epoch,
                createdAt: new Date(), // FIXME
            }
        })
        await PosReward.sequelize.transaction(async (dbTx)=>{
            return Promise.all([
                PosReward.bulkCreate(rewardBeans, {transaction: dbTx}),
                Promise.all(rewardBeans.map(b=>{
                    const diff:any = b.reward.toString()
                    return PosAccount.increment('totalReward',
                        {by: diff,
                            where: {id: b.accountId},
                            transaction: dbTx,
                            logging: console.log,
                        })
                }))
            ])
        })
        return 1 // indicate increase epoch by 1
    }
    async test() {
        console.log(`===================== pos test ========`)
        console.log(` rpc version :`, await this.cfx.getClientVersion())
        console.log(` rpc status :`, await this.cfx.getStatus())
        // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
        const st = await this.cfx["pos"].getStatus()
        console.log(` status ${JSON.stringify(st)}`)
        const powBlock = await this.cfx.getBlockByEpochNumber(199);
        console.log(` pow block detail: `, powBlock)
        console.log(` pos block detail: `, await this.cfx['pos'].getBlockByHash(powBlock["posReference"]))
        // await this.getCommittee(st.latestCommitted).catch(console.log)
        // await this.getCommittee(1).catch(console.log)
        // await this.getCommittee(st.latestVoted).catch(console.log)
        // await this.getCommittee(st.pivotDecision).catch(console.log)
        // await this.syncCommittee()
        // await this.repeatSyncTx()
        // @ts-ignore
        // console.log(`getPoSEconomics: `,await this.cfx.getPoSEconomics());
        for (let i=0; i<0; i++) {
            const rewardInfo = await this.cfx['pos'].getRewardsByEpoch(i);
            if (rewardInfo === null) {
                process.stdout.write('\r\u001b[2K null at '+i)
                continue
            }
            console.log(`getRewardsByEpoch ${i}: `, rewardInfo);
        }
        // console.log(`getAccount: `,await this.cfx.getAccount('net8888:aakyb6jws3f2x7hr3ap3gwc3rjznj4r9eebeccmwvz'));

    }
    async computeRewardStartAt(powEpoch:number) {
        const powBlock = await this.cfx.getBlockByEpochNumber(powEpoch)
        const posBlock = await this.cfx['pos'].getBlockByHash(powBlock['posReference'])
        return posBlock.epoch
    }
}
if (require.main === module) {
    const args = process.argv.slice(2)
    const url = args[0]
    const cfx = new Conflux({url})
    const posSync = new PosSync(cfx);
    const rewardStartAtPow = args[1] ? parseInt(args[1]) : 200_000
    init().then(()=> {
        return posSync.init()
    }).then(()=>{
        return posSync.updateLatestBlockNumber()
    }).then(()=>{
        if (args.includes('test')) {
            new PosQuery(cfx).posInfo().then(info=>{
                console.log(` pos info:`, info)
            })
            return;
        }
        // posSync.sync(2).then()
        // cfx['pos'].getBlockByNumber(153).then(res=>{
            // console.log(` pos block `, res)
        // })
        // cfx['pos'].getAccount('0x867d88952f32f19a965282d5d60f89b9bb384a1b0f414180d093c3edc3f9d055').then(console.log)
        // posSync.patchCreatedAccount(0, '0x867d88952f32f19a965282d5d60f89b9bb384a1b0f414180d093c3edc3f9d055')

        return Promise.all([
            // posSync.test(),
            posSync.run(),
            posSync.repeatFetchCommittee(),
            posSync.repeatSyncTx(),
            posSync.repeatSyncRewards(rewardStartAtPow),
        ])
    })
}
/*
Rpc Document
https://github.com/Pana/conflux-doc/blob/update-rpc/docs/pos-rpc-zh.md#AccountStatus
 */