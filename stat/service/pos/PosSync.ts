import {Conflux} from "js-conflux-sdk";
const lodash = require('lodash');
import {regExitHook, sleep} from "../tool/ProcessTool";
import {
    IPosAccountBlock, IPosReward,
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee,
    PosCommitteeNode, PosDailyStat, PosEpochRewardHash, PosReward,
    PosTransaction
} from "../../model/PoS";
import {init} from "../tool/FixDailyTokenStat";
import {fn, col, Op, QueryTypes} from "sequelize";
import {PosQuery} from "./PosQuery";
import {removeLongData} from "../common/utils";
import {KV, TOTAL_POS_REWARD} from "../../model/KV";
import {
    fixDailyPosAccountCount,
    PosStat, scheduleDailyParticipation,
    scheduleDailyStakingDepositWithdraw,
    scheduleDailyStatMix,
    scheduleSyncPosGap
} from "./PosStat";
// import {abi as posAbi} from "../abi/PosRegister"
const {abi: posAbi} = require("../abi/PoSRegister")

export class PosSync {
    private cfx: Conflux;
    private position: number;
    private latestBlockNumber: 0;
    private posContract: any;
    private dbLocked = false;
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
        let st;
        try {
            st = await this.cfx.pos.getStatus();
        } catch (e) {
            console.log(` get status fail:`, e)
            return
        }
        // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
        // console.log(` status : ${JSON.stringify(st)}`)
        this.latestBlockNumber = st["latestVoted"] || st.latestCommitted;
        console.log(` update latestBlockNumber to ${this.latestBlockNumber
        }, status voted ${st.latestVoted} committed ${st.latestCommitted}`)
    }
    async repeatSyncBlock() {
        // syn block thread.
        const that = this;
        if (this.position < this.latestBlockNumber) {
            let delay = 0
            await this.syncBlock(this.position)
                .then(()=>{
                    that.position += 1
                })
                .catch(err=>{
                    console.log(` repeatSyncBlock error at ${that.position} `, err)
                    delay = 10_000
                })
            setTimeout(()=>this.repeatSyncBlock(), delay)
        } else {
            await sleep(5_000)
            await this.updateLatestBlockNumber()
            setTimeout(()=>this.repeatSyncBlock(), 0)
        }
    }

    async syncBlock(blockNumber) {
        const [blockDetail, preBlock, preBlockDetail] = await Promise.all([
            this.cfx.pos.getBlockByNumber(blockNumber),
            PosBlock.findByPk(blockNumber - 1),
            this.cfx.pos.getBlockByNumber(blockNumber - 1),
        ])
        if (blockDetail === null) {
            await this.updateLatestBlockNumber();
            throw new Error(`block detail is null, ${blockNumber}, latest ${this.latestBlockNumber}`)
        }
        if (blockNumber >= 3 && preBlock !== null && blockDetail.parentHash !== preBlock.hash
            // when epoch is changing, it's designed that a new block is build as genesis.
            && preBlock.epoch === blockDetail.epoch) {
            const preAccountIds = await PosAccountBlock.findAll({attributes: ['accountId'],
                where: {blockNumber: preBlock.height}}).then(arr=>arr.map(row=>row.accountId))
            // reorg happens
            console.log(` ${new Date().toISOString()} block number ${blockNumber}, parent hash ${blockDetail.parentHash
            } \n not match previous block hash ${preBlock.hash} with number ${preBlock.height}`)
            // fetch from chain node
            const infoDebug = await Promise.all([
                this.cfx.pos.getBlockByNumber(preBlock.height),
                this.cfx.pos.getBlockByNumber(blockNumber),
            ]).then(arr=>arr.map(blk=>{
                return `block height ${blk.height} epoch ${blk.epoch} hash ${blk.hash} \n parentHash ${blk.parentHash}`
            })).then(arr=>arr.join('\n'));
            console.log(` debug info :\n${infoDebug}`)
            await this.waitLock();
            await PosBlock.sequelize.transaction(async (dbTx)=>{
                return Promise.all([
                    preBlock.destroy({transaction: dbTx}),
                    PosTransaction.destroy({where: {blockNumber: preBlock.height}, transaction: dbTx}),
                    this.diffMineCount(preBlock.minerId, -1, dbTx),
                    this.diffSignCount(preAccountIds, -1, dbTx),
                    PosAccountBlock.destroy({where: {blockNumber: preBlock.height}, transaction: dbTx}),
                ]);
            }).finally(()=>{
                this.dbLocked=false
            })
            this.position -= 2 // +1 at caller. re-syn previous block.
            await sleep(5_000)
            return;
        }
        const dt = new Date(blockDetail.timestamp/1000);
        //console.log(` block timestamp is ${blockDetail.timestamp} ${dt.toISOString()} ${blockNumber}`)
        let minerId = null;
        if (blockDetail.miner) {
            minerId = await this.saveAccount(blockDetail.miner, dt)
        }
        const map = new Map<string, number>()
        const accountBlockBeans:IPosAccountBlock[] = []
        const accountIds = []
        for (const s of blockDetail.signatures) {
            const id = await this.saveAccount(s.account, dt)
            map.set(s.account, id)
            accountBlockBeans.push({accountId: id, blockNumber, id: null, votes: s.votes})
            accountIds.push(id)
        }
        // next tx number is the last tx number of the block, in fact.
        const preNextTxNumber = preBlock?.nextTxNumber
            || preBlockDetail?.['lastTxNumber']
            || await detectTxCountAtPosBlock1(this.cfx);
        const txIdEndInclude = blockDetail['lastTxNumber'];
        const txArr = await this.fetchTxArr(preNextTxNumber+1, txIdEndInclude);
        if (txArr === null) {
            this.position -= 1
            await sleep(3_000)
            return;
        }
        const txCountByDiff = txIdEndInclude - preNextTxNumber;
        if (txArr.length !== txCountByDiff) {
            console.log(` block number ${blockNumber} tx count not match, count by diff ${txIdEndInclude
            } - ${preNextTxNumber} = ${txCountByDiff
            } , actual tx ${txArr.length}`)
            const info = [preBlockDetail,blockDetail].map(block=>{
                return ` block height [${block?.height}] nextTx [${block?.['lastTxNumber']
                }], hash ${block?.hash}`;
            }).join('\n')
            console.log(` debug block lastTxNumber:\n`, info)
            this.position -= 1 // +1 at caller. sync again.
            await sleep(30_000)
            return;
        }
        await this.waitLock()
        await PosAccountBlock.sequelize.transaction(async tx=>{
            await Promise.all([
                PosBlock.create(
                        this.createBlockBean(dt, blockDetail, minerId, txCountByDiff),
                    {transaction: tx}
                    ).catch(err=>{
                        delete blockDetail.signatures;
                        console.log(` sync pos block, save to db fail, data:`, blockDetail)
                        console.log(` error is :`, err)
                        throw err
                    }),
                PosAccountBlock.bulkCreate(accountBlockBeans, {transaction: tx}),
                // update account signCount
                this.diffMineCount(minerId, 1, tx),
                this.diffSignCount(accountIds, 1, tx),
                // save tx
                PosTransaction.bulkCreate(txArr, {transaction: tx}),
            ])
        }).finally(()=>{
            this.dbLocked = false;
        });

        // console.log(`pos sync block:`, blockDetail)
        if (blockNumber % 100 === 1) {
            console.log(`pos sync block number ${blockNumber}, tx count ${txArr.length}`)
        }
    }
    async diffMineCount(minerId: number, v:number, tx) {
        if (!minerId) {
            return
        }
        return PosAccount.increment('mineCount', {
            by: v, where: {id: minerId}, transaction: tx,
        })
    }
    async diffSignCount(accountIds:number[], v:number, tx) {
        if (!accountIds.length) {
            return;
        }
        return PosAccount.increment('signCount', {
            by: v, where: {id: {[Op.in]:accountIds}}, transaction: tx,
        })
    }
    private createBlockBean(dt: Date, blockDetail: any, minerId, txCountByDiff: number) {
        return {
            createdAt: dt,
            epoch: blockDetail.epoch,
            hash: blockDetail.hash,
            height: blockDetail.height,
            minerId: minerId,
            parentHash: blockDetail.parentHash?.substr(2, 4),
            pivotDecision: blockDetail.pivotDecision?.height,
            round: blockDetail.round,
            timestamp: blockDetail.timestamp,
            transactionCount: txCountByDiff,
            nextTxNumber: blockDetail['lastTxNumber'],
            signatureCount: blockDetail.signatures?.length || 0,
        };
    }

    async saveAccount(hex:string, dt: Date) : Promise<number> {
        return PosAccount.make(hex, dt,(id)=>{
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
        const [info, {status: posStatus}] = await Promise.all([
            this.posContract.identifierToAddress(hex),
            this.cfx['pos'].getAccount(hex),
        ])
        // console.log(` identifierToAddress ${hex}, got `, info)
        return PosAccount.update({powBase32: info,
            availableVotes: posStatus.availableVotes || 0,
            lockedVotes: posStatus.locked || 0,
            unlockedVotes: posStatus.unlocked || 0,
            forfeitedVotes: posStatus.forfeited || 0,
            forceRetiredVotes: posStatus.forceRetired || 0,
        }, {
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
    committeeBlockPosition = 0
    async syncCommittee() {
        const [status, maxCommitteeDB] = await Promise.all([
            this.cfx["pos"].getStatus(),
            PosCommittee.findOne({order:[['blockNumber','desc']]}),
        ])
        // It's pos block number
        let cursorBlock = this.committeeBlockPosition || maxCommitteeDB?.blockNumber || 1
        const startAt = cursorBlock
        let cursorEpoch = maxCommitteeDB?.epochNumber || 0
        let epochChanged = false
        while(cursorBlock < status.latestCommitted) {
            const epochGrow = await this.syncCommitteeByBlockNumber(cursorBlock, cursorEpoch);
            cursorBlock += 1
            this.committeeBlockPosition = cursorBlock;
            if (epochGrow) {
                epochChanged = true
                cursorEpoch +=1
            }
        }
        console.log(` syncCommittee start at ${startAt}, status epoch ${status.epoch} block committed ${status.latestCommitted}`)
        // refresh account information when pos epoch changing.
        if (epochChanged) {
            // do not refresh when catching up.
            await this.updateRecentCommitteeAccount(status.epoch);
            await this.updateDailyStat(status.epoch);
        }
    }

    async updateRecentCommitteeAccount(epoch: number) {
        const recentGap = 10; // hour
        const listOfAccountId = await PosCommitteeNode.findAll({
            attributes: [
                [fn('distinct', col('accountId')), 'accountId']
            ],
            where: {epochNumber: {[Op.between]: [epoch - recentGap, epoch]}},
        }).then(res => {
            return res.map(row => row.accountId)
        })
        if (!listOfAccountId.length) {
            console.log(` account ids is empty.`)
            return;
        }
        const accountList = await PosAccount.findAll({
            where: {id: {[Op.in]: listOfAccountId}}
        })
        if (!accountList.length) {
            console.log(` account list is empty, but with ids: ${listOfAccountId.join(",")}`);
            return;
        }
        return this.updateAccountVotes(accountList);
    }
    async updateDailyStat(epoch:number) {
        const [{totalPosStakingTokens}, lockedVotes] = await Promise.all([
            this.cfx.getPoSEconomics(),
            PosAccount.sum('lockedVotes'),
        ])
        const dt = new Date();
        const [affected] = await PosDailyStat.update({stakingAmount: totalPosStakingTokens, lockedVotes},
            {where: {statDay: dt}})
        if (!affected) {
            await PosDailyStat.create({
                statDay: dt,
                stakingAmount: totalPosStakingTokens, lockedVotes,
                createdAt: dt, updatedAt: dt, epoch,
            })
        }
        console.log(` update daily stat done.`)
    }
    async updateAccountVotes(accountList: PosAccount[]) {
        //
        const chunks2d: PosAccount[][] = lodash.chunk(accountList, 50);
        const batchArr = chunks2d.map(chunks=>{
            const batch = this.cfx.BatchRequest();
            chunks.forEach(acc=>{
                // @ts-ignore
                batch.add(this.cfx.pos.getAccount.request(acc.hex))
            });
            return batch
        })
        const results2d = await Promise.all(batchArr.map(b=>b.execute()))
        const results = lodash.flatten(results2d);
        const updateTasks = results.map(accInfo=>{
            const status = accInfo.status;
            return PosAccount.update({
                availableVotes: status.availableVotes,
                lockedVotes: status.lockedVotes,
                unlockedVotes: status.unlockedVotes,
                forfeitedVotes: status.forfeitedVotes || 0,
                forceRetiredVotes: status.forceRetiredVotes || 0,
            }, {where: {hex: accInfo.address}})
        })
        await this.waitLock()
        await Promise.all(updateTasks).finally(()=>{
            this.dbLocked = false;
        });
        console.log(` update account votes, count ${updateTasks.length}`)
    }
    async updateAllAccountVotes() {
        let i = 0
        let pageSize = 100
        do {
            const list = await PosAccount.findAll({where: {id:{[Op.gte]: i}},
                order: [['id','asc']], limit: pageSize});
            if (list.length === 0) {
                break;
            }
            await this.updateAccountVotes(list);
            i = list[list.length - 1].id + 1;
        } while (true)
        console.log(` update all account votes done.`)
    }
    private async syncCommitteeByBlockNumber(cursorBlock: number, cursorEpoch) {
        // fetch by pos block number, but only save when epoch changing.
        const rpcResult = await this.getCommittee(cursorBlock);
        if (this.NOT_FOUND_COMMITTEE === rpcResult) {
            return false
        }
        // @ts-ignore
        const {currentCommittee} = rpcResult;
        if (currentCommittee.epochNumber <= cursorEpoch) {
            return false
        }
        // make account id
        for (const n of currentCommittee.nodes) {
            n.accountId = await this.saveAccount(n.address, new Date());
        }
        const block = await this.cfx.pos.getBlockByNumber(cursorBlock)
        let blockDt = new Date(block.timestamp/1000);
        // save to db
        await PosCommittee.sequelize.transaction(async (dbTx) => {
            return Promise.all([
                PosCommittee.create({
                    ...currentCommittee, blockNumber: cursorBlock, nodesCount: currentCommittee.nodes.length,
                }, {transaction: dbTx}),
                PosCommitteeNode.bulkCreate(currentCommittee.nodes.map(n => {
                    // console.log(` node is ${JSON.stringify(n)}`)
                    return {
                        ...n, epochNumber: currentCommittee.epochNumber, blockNumber: cursorBlock,
                        createdAt: blockDt
                    }
                }, {transaction: dbTx}))
            ])
        })
        console.log(` save committee, epoch ${currentCommittee.epochNumber} block number ${cursorBlock}, nodes count ${currentCommittee.nodes.length}`)
        return true
    }
    readonly NOT_FOUND_COMMITTEE = {}
    async getCommittee(blockNumber: number) {
        // const info = await this.cfx["pos"].getCommittee(undefined)
        const info = await this.cfx.pos.getCommittee(blockNumber).catch(err=>{
            if (/PoS state of \d+ not found/.test(err.message)) {
                // console.log(` It's ok. ${err.message}`);
                return this.NOT_FOUND_COMMITTEE
            }
            throw err
        })
        // console.log(` committee info of block number ${blockNumber.toString().padStart(8, ' ')}: `, JSON.stringify(info, ))
        return info
    }
    async fetchTxArr(start:number, endInclude:number) {
        let next = start;
        const txArr = []
        const that = this
        while(next <= endInclude) {
            const tx = await that.cfx.pos.getTransactionByNumber(next).catch(err=>{
                console.log(` getTransactionByNumber fail, ${next}:`, err)
                return null
            })
            if (tx === null) {
                console.log(` fetch pos tx got null at number ${next}`)
                return txArr;
            } else {
                const dt = new Date(tx.timestamp/1000)
                const accountId = await that.saveAccount(tx.from, dt)
                txArr.push({
                    blockNumber: tx.blockNumber,
                    fromId: accountId, number: next, status: tx.status, type: tx.type,
                    createdAt: dt,
                    hash: tx.hash,
                })
                next += 1
            }
        }
        return txArr;
    }
    async repeatSyncRewards() {
        const that = this
        let nextEpoch = await PosReward.findOne({order:[['id','desc']]}).then(res=>{
            if (res === null) {
                return 0
            } else {
                return res.epoch + 1
            }
        })
        async function findRoot() {
            let position = 0;
            do {
                const reward = await that.cfx.pos.getRewardsByEpoch(position)
                if (reward?.accountRewards?.length) {
                    console.log(` has reward at ${position}`, reward)
                    nextEpoch = position
                    break;
                }
                console.log(`no reward at ${position}`, reward)
                position ++;
                if (position > 100) {
                    break;
                }
                await sleep(1_000)
            } while (true)
        }
        async function repeat() {
            try {
                if (nextEpoch === 0) {
                    await findRoot();
                }
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
    async calculateTotalPosReward(diff, dbTx) {
        const dripDb = await KV.getString(TOTAL_POS_REWARD, "0")
        const drip = BigInt(dripDb);
        const total = drip + BigInt(diff)
        await KV.upsert({key:TOTAL_POS_REWARD, value: total.toString()}, {
            transaction: dbTx
        })
    }
    async syncRewardByEpoch(epoch:number) {
        let rewardInfo = await this.cfx.pos.getRewardsByEpoch(epoch)
        if (!rewardInfo) {
            console.log(` pos reward is ${rewardInfo} at epoch ${epoch}`);
            const rewardInfoNext = await this.cfx.pos.getRewardsByEpoch(epoch+1)
            if (rewardInfoNext) {
                console.log(`skip to next`)
                return 1;
            }
            await sleep(10_000)
            return 0
        }
        const powBlock = await this.cfx.getBlockByHash(rewardInfo.powEpochHash).catch(err=>{
            console.log(` sync pos reward at epoch ${epoch}, `, err)
            return null;
        });
        if (powBlock === null) {
            return 0;
        }
        const powDate = new Date(powBlock.timestamp * 1000);
        const accountRewards = rewardInfo.accountRewards;
        const posAddrArr = accountRewards.map(r=>r.posAddress)
        const accounts = await PosAccount.findAll({
            attributes: ['id','hex'],
            where: {hex: {[Op.in]:posAddrArr}}
        })
        const accountMap = new Map<string, {id: number}>()
        accounts.forEach(a=>accountMap.set(a.hex, a))
        if (posAddrArr.length !== accounts.length) {
            const missingHexArr = posAddrArr.filter(hex=>!accountMap.has(hex))
            console.log(` syncRewardByEpoch epoch ${epoch} account absent, want ${posAddrArr.length}\n actual ${accounts.length
                }, missing ${missingHexArr.length}, they are ${missingHexArr.join(',')}`)
            const dt = new Date()
            for (let i = 0; i < missingHexArr.length; i++){
                let hex = missingHexArr[i];
                const id = await this.saveAccount(hex, dt)
                accountMap.set(hex, {id})
            }
            // await sleep(5_000)
            // return 0
        }
        //@ts-ignore
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
                createdAt: powDate,
            }
        })
        const totalReward = accountRewards.map(r=>r.reward).reduce((a,b)=>a+b)
        await this.waitLock()
        await PosReward.sequelize.transaction(async (dbTx)=>{
            return Promise.all([
                PosReward.bulkCreate(rewardBeans, {transaction: dbTx}),
                Promise.all(rewardBeans.map((b,idx)=>{
                    const diff:any = b.reward.toString()
                    return PosAccount.increment('totalReward',
                        {by: diff,
                            where: {id: b.accountId},
                            transaction: dbTx,
                            logging: idx === 0 ? console.log : false,
                        })
                })),
                PosEpochRewardHash.create({epoch, powEpochHash: rewardInfo.powEpochHash, powDate,
                    powEpoch: powBlock.epochNumber, drip: BigInt(totalReward)},
                    {transaction: dbTx}),
                this.calculateTotalPosReward(totalReward, dbTx),
            ])
        }).finally(()=>{
            this.dbLocked = false;
        })
        return 1 // indicate increase epoch by 1
    }
    async waitLock() {
        while (this.dbLocked) {
            await sleep(100)
        }
        this.dbLocked = true;
    }
    async test() {
        console.log(`===================== pos test ========`)
        console.log(` rpc version :`, await this.cfx.getClientVersion())
        console.log(` rpc status :`, await this.cfx.getStatus())
        // {"epoch":40,"latestCommitted":2397,"latestVoted":2399,"pivotDecision":925080}
        const st = await this.cfx["pos"].getStatus()
        console.log(` status ${JSON.stringify(st)}`)
        // const next = await Promise.all([5446,5447,5448].map(n=>this.cfx.pos.getBlockByNumber(n).then(res=>{
        //     return ` block number ${res.height}, next tx number ${res.nextTxNumber}`
        // })))
        //     .then(arr=>arr.join('\n'))
        // console.log(` next tx numbers \n ${next}`)
        console.log(` reward ${await this.cfx.pos.getRewardsByEpoch(0)}`)
        console.log(` reward ${await this.cfx.pos.getRewardsByEpoch(1)}`)
        // const powBlock = await this.cfx.getBlockByEpochNumber(199);
        // console.log(` pow block detail: `, powBlock)
        // console.log(` pos block detail: `, await this.cfx['pos'].getBlockByHash(powBlock["posReference"]))
        // await this.getCommittee(st.latestCommitted).catch(console.log)
        // await this.getCommittee(1).catch(console.log)
        // await this.getCommittee(st.latestVoted).catch(console.log)
        // await this.getCommittee(st.pivotDecision).catch(console.log)
        // await this.syncCommittee()
        // await this.repeatSyncTx()
        // @ts-ignore
        // console.log(`getPoSEconomics: `,await this.cfx.getPoSEconomics());
        // for (let i=0; i<0; i++) {
        //     const rewardInfo = await this.cfx['pos'].getRewardsByEpoch(i);
        //     if (rewardInfo === null) {
        //         process.stdout.write('\r\u001b[2K null at '+i)
        //         continue
        //     }
        //     console.log(`getRewardsByEpoch ${i}: `, rewardInfo);
        // }
        // console.log(`getAccount: `,await this.cfx.getAccount('net8888:aakyb6jws3f2x7hr3ap3gwc3rjznj4r9eebeccmwvz'));

    }
}
export async function detectTxCountAtPosBlock1(cfx:Conflux) {
    const initTxNumber = 1
    let txNumber = initTxNumber
    do {
        const tx = await cfx.pos.getTransactionByNumber(txNumber)
        if (tx.blockNumber > 1) {
            // find the first tx in block 2
            break;
        }
        txNumber += 1
    } while (true)
    return txNumber - initTxNumber;
}
if (require.main === module) {
    regExitHook()
    start().then()
}
async function start() {
    const [,,urlParam, cmd] = process.argv
    const cfg = await init()
    const url = urlParam || cfg.conflux.url
    const cfx = new Conflux({url})
    const st = await cfx.getStatus()
    console.log(`------ ${url} network ${st.networkId} ------`)
    const posSync = new PosSync(cfx);
    await posSync.init()
    // wait pos enable
    while (true) {
        try {
            await cfx.pos.getStatus()
            break;
        } catch (e) {
            if (e.message.includes('PoS chain is not enabled')) {
                console.log(` wait. ${e}`)
                await sleep(10_000)
                continue
            }
            console.log(` get pos status fail when startup:`, e)
            throw e;
        }
    }
    await posSync.updateLatestBlockNumber()
    {
        // cfx.getBlockByEpochNumber(345000).then(blk=>{
        //     removeLongData(blk)
        //     console.log(` block is `, blk)
        // })
        if (cmd === 'test') {
            posSync.test().then(()=>{
                process.exit(0)
            })
            return;
        } else if (cmd === 'fixAccCnt') {
            await fixDailyPosAccountCount()
            return
        } else if (cmd === 'testDailyStatMix') {
            const svc = new PosStat(cfx)
            await svc.update()
            return
        } else if (cmd === 'updateAllAccount') {
            posSync.updateAllAccountVotes().then(()=>{
                process.exit(0)
            })
            return;
        }
        // posSync.sync(2).then()
        // cfx['pos'].getBlockByNumber(153).then(res=>{
            // console.log(` pos block `, res)
        // })
        // cfx['pos'].getAccount('0x867d88952f32f19a965282d5d60f89b9bb384a1b0f414180d093c3edc3f9d055').then(console.log)
        // posSync.patchCreatedAccount(0, '0x867d88952f32f19a965282d5d60f89b9bb384a1b0f414180d093c3edc3f9d055')
        scheduleDailyStatMix(cfx).then()
        scheduleSyncPosGap().then()
        scheduleDailyStakingDepositWithdraw().then()
        scheduleDailyParticipation().then()
        return Promise.all([
            // posSync.test(),
            posSync.repeatSyncBlock(),
            posSync.repeatFetchCommittee(),
            posSync.repeatSyncRewards(),
            // posSync.updateRecentCommitteeAccount(8),
        ])
    }
}

/*
Rpc Document
https://github.com/Pana/conflux-doc/blob/update-rpc/docs/pos-rpc-zh.md#AccountStatus
 */