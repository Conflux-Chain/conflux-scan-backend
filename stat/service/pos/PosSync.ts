import {Conflux} from "js-conflux-sdk";
const lodash = require('lodash');
import {sleep} from "../tool/ProcessTool";
import {
    IPosAccountBlock, IPosReward,
    PosAccount,
    PosAccountBlock,
    PosBlock,
    PosCommittee,
    PosCommitteeNode, PosEpochRewardHash, PosReward,
    PosTransaction
} from "../../model/PoS";
import {init} from "../tool/FixDailyTokenStat";
import {fn, col, Op, QueryTypes} from "sequelize";
import {PosQuery} from "./PosQuery";
import {removeLongData} from "../common/utils";
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
            console.log(`block number ${blockNumber}, parent hash ${blockDetail.parentHash
            } \n not match previous block hash ${preBlock.hash} with number ${preBlock.height}`)
            // fetch from chain node
            const infoDebug = await Promise.all([
                this.cfx.pos.getBlockByNumber(preBlock.height),
                this.cfx.pos.getBlockByNumber(blockNumber),
            ]).then(arr=>arr.map(blk=>{
                return `block height ${blk.height} epoch ${blk.epoch} hash ${blk.hash} \n parentHash ${blk.parentHash}`
            })).then(arr=>arr.join('\n'));
            console.log(` debug info :\n${infoDebug}`)
            await PosBlock.sequelize.transaction(async (dbTx)=>{
                return Promise.all([
                    preBlock.destroy({transaction: dbTx}),
                    PosTransaction.destroy({where: {blockNumber: preBlock.height}, transaction: dbTx}),
                    this.diffMineCount(preBlock.minerId, -1, dbTx),
                    this.diffSignCount(preAccountIds, -1, dbTx),
                    PosAccountBlock.destroy({where: {blockNumber: preBlock.height}, transaction: dbTx}),
                ]);
            })
            this.position -= 2 // +1 at caller. re-syn previous block.
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
        const preNextTxNumber = blockNumber === 2 ? 2 : preBlock?.nextTxNumber || 1;
        const txIdStopBefore = blockNumber === 1 ? 2 : blockDetail.nextTxNumber;
        const txArr = await this.fetchTxArr(preNextTxNumber, txIdStopBefore, blockNumber);
        if (txArr === null) {
            this.position -= 1
            await sleep(3_000)
            return;
        }
        const txCountByDiff = txIdStopBefore - preNextTxNumber;
        if (txArr.length !== txCountByDiff) {
            console.log(` block number ${blockNumber} tx count not match, count by diff ${txIdStopBefore
            } - ${preNextTxNumber} = ${txCountByDiff
            } , actual tx ${txArr.length}`)
            const info = [preBlockDetail,blockDetail].map(block=>{
                return ` block height [${block?.height}] nextTx [${block?.nextTxNumber
                }], hash ${block?.hash}`;
            }).join('\n')
            console.log(` debug block nextTxNumber:\n`, info)
            this.position -= 1 // +1 at caller. sync again.
            await sleep(30_000)
            return;
        }
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
            pivotDecision: blockDetail.pivotDecision,
            round: blockDetail.round,
            timestamp: blockDetail.timestamp,
            transactionCount: txCountByDiff,
            nextTxNumber: blockDetail.nextTxNumber,
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
    async syncCommittee() {
        const [status, maxEpochAtDB] = await Promise.all([
            this.cfx["pos"].getStatus(),
            PosCommittee.max('epochNumber').then(res=>{
                return Number.isNaN(res) ? -1 : (Number(res))
            }),
        ])
        let cursor = maxEpochAtDB + 1;
        while(cursor < status.epoch) {
            await this.syncCommitteeByBlockNumber(cursor);
            cursor += 1
        }
        console.log(` syncCommittee Done for this round, start at ${maxEpochAtDB+1}`)
        // refresh account information when pos epoch changing.
        if (maxEpochAtDB + 1 === status.epoch) {
            // do not refresh when catching up.
            await this.updateRecentCommitteeAccount(status.epoch);
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
        await Promise.all(updateTasks);
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
    private async syncCommitteeByBlockNumber(cursor: number) {
        const rpcResult = await this.getCommittee(cursor);
        if (this.NOT_FOUND_COMMITTEE === rpcResult) {
            return
        }
        // @ts-ignore
        const {currentCommittee} = rpcResult;
        // make account id
        for (const n of currentCommittee.nodes) {
            n.accountId = await this.saveAccount(n.address, new Date())
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
        console.log(` save committee, epoch ${currentCommittee.epochNumber} block number ${cursor}, nodes count ${currentCommittee.nodes.length}`)
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
    async fetchTxArr(start:number, stopBefore:number, blockNumber) {
        let next = start;
        const txArr = []
        const that = this
        while(next < stopBefore) {
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
                    blockNumber: blockNumber,
                    fromId: accountId, number: next, status: tx.status, type: tx.type,
                    createdAt: dt,
                    hash: tx.hash,
                })
                next += 1
            }
        }
        return txArr;
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
        const rewardInfo = await this.cfx.pos.getRewardsByEpoch(epoch)
        if (rewardInfo === null) {
            if (epoch === 0) {
                const rewardEpoch1 = await this.cfx.pos.getRewardsByEpoch(1)
                if (rewardEpoch1 !== null) {
                    console.log(` epoch 0 has no reward but epoch 1 has, move to epoch 1.`)
                    return 1;
                }
            }
            console.log(` reward is null at epoch ${epoch}`);
            await sleep(10_000)
            return 0
        }
        const powBlock = await this.cfx.getBlockByHash(rewardInfo.powEpochHash).catch(err=>{
            console.log(` sync pos reward at epoch ${epoch}, `, err)
            return null;
        })
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
                PosEpochRewardHash.create({epoch, powEpochHash: rewardInfo.powEpochHash, powDate},
                    {transaction: dbTx})
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
    async computeRewardStartAt(powEpoch:number) {
        console.log(` computeRewardStartAtPow epoch ${powEpoch}`)
        const powBlock = await this.cfx.getBlockByEpochNumber(powEpoch)
        const posRef = powBlock['posReference'];
        removeLongData(powBlock)
        if (posRef === null) {
            console.log(` computeRewardStartAtPow fail, pow block `, powBlock)
            process.exit(1)
        }
        try {
            const posBlock = await this.cfx['pos'].getBlockByHash(posRef)
            if (powBlock === null) {
                console.log(` pos block not found, pow block, `, powBlock)
                process.exit(2)
            }
            console.log(` pos reward at pow hash ${powBlock.hash}, pos ref ${posRef
            }, height ${posBlock.height}, epoch ${posBlock.epoch}`)
            return posBlock.epoch;
        } catch (e) {
            console.log(` pos get block by hash fail, pow epoch ${powEpoch}, pos ref: ${posRef}: `, e)
            process.exit(3)
        }
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
        // cfx.getBlockByEpochNumber(345000).then(blk=>{
        //     removeLongData(blk)
        //     console.log(` block is `, blk)
        // })
        if (args.includes('test')) {
            posSync.test().then(()=>{
                process.exit(0)
            })
            return;
        } else if (args.includes('updateAllAccount')) {
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

        return Promise.all([
            // posSync.test(),
            posSync.repeatSyncBlock(),
            posSync.repeatFetchCommittee(),
            posSync.repeatSyncRewards(rewardStartAtPow),
            // posSync.updateRecentCommitteeAccount(8),
        ])
    })
}
/*
Rpc Document
https://github.com/Pana/conflux-doc/blob/update-rpc/docs/pos-rpc-zh.md#AccountStatus
 */