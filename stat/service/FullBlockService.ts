//@ts-ignore
import { Conflux, format } from "js-conflux-sdk";
import {AddressTransactionIndex, FullBlock, FullTransaction, IFullBlock} from "../model/FullBlock";
import { makeId } from "../model/HexMap";
import { fmtDtUTC } from "../model/Utils";
import { BlockAndMinerSync } from "./BlockAndMinerSync";

const CODE_REWIND = 20201029
const CODE_CONTINUE = 2020102903
const CODE_EMPTY_BLOCK = 2020102907
export class FullBlockService {
    public cfx: Conflux;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
    }
    // sync metrics
    private metrics = {
        ms : new Date().getTime(),
        executedTxCount : 0,
        addressTxCount: 0,
        blockCount: 0,
    }
    // sync metrics end
    private previousPivotHash:string

    private async resetPreviousPivotHash(useWhichEpoch:number) {
        let maxAtDb = await FullBlock.findOne({
            where: {epoch: useWhichEpoch, pivot: true}
        });
        console.log(`use max block ${maxAtDb.epoch} ${maxAtDb.hash}`)
        this.previousPivotHash = maxAtDb.hash
    }
    public async run(always = false) {
        let maxEpoch:number = await FullBlock.max('epoch')
        if (isNaN(maxEpoch)) {
           maxEpoch = -1 // plus 1 got 0
        } else {
            await this.resetPreviousPivotHash(maxEpoch)
        }
        let ret
        do {
            ret = await this.syncBlockByEpoch(maxEpoch+1).catch(err=>{
                const errStr = `${err}`
                if (errStr.includes('Lock wait timeout exceeded;')) {
                    console.log(`lock time out at epoch ${maxEpoch}:`, err)
                    return {code: CODE_CONTINUE}
                }
                console.log(`sync block fail at epoch ${maxEpoch}`, err)
                throw err;
            })
            if (ret.code === CODE_REWIND) {
                maxEpoch -= 1;
            } else if (ret.code === CODE_CONTINUE) {
                // try again
            } else if (ret.coode === CODE_EMPTY_BLOCK) {
                console.log(`empty block at epoch ${ret.epoch}, ${ret.message}`)
                await new Promise(r=>setTimeout(r, 500))
            } else {
                maxEpoch += 1
            }
        } while (always)
        return ret
    }
    public async syncBlockByEpoch(minEpochNumber: number) {
        const [rewardList, hashes] = await Promise.all([
            this.cfx.getBlockRewardInfo(minEpochNumber).catch(async err=>{
                const msg = `${err}`
                console.log(`get reward info fail at epoch ${minEpochNumber}: ${msg}`)
                if (msg.includes('expected a numbers with less than largest epoch number.')) {
                    // https://developer.conflux-chain.org/docs/conflux-doc/docs/json_rpc/#the-epoch-number-parameter
                    const latest = await this.cfx.getEpochNumber('latest_state') // for the latest epoch that has been executed.
                    console.log(`latest_state ${latest}`)
                }
                return [];
            }),
            this.cfx.getBlocksByEpochNumber(minEpochNumber).catch(err=>{
                console.log(`FullBlock: fetch blocks by epoch number fail, epoch ${minEpochNumber}.`, err)
                return []
            })
        ])
        let blockList: any/*IFullBlock*/[] = (await Promise.all(
            (hashes as []).map(hash=>{
                return this.cfx.getBlockByHash(hash, true)
            })
        )) as IFullBlock[]
        if (blockList.length === 0) {
            return {
                code: CODE_EMPTY_BLOCK, message: "block list is empty", blockCount: 0, epoch: minEpochNumber
            }
        }
        // blockList = blockList.reverse(); // turn to asc order.
        let ok = true;
        let message = "ok";
        // the last one is pivot block.
        let pivotBlock = blockList[blockList.length-1];
        if (pivotBlock.parentHash !== this.previousPivotHash && minEpochNumber > 0) {
            // pivot switch, pop and re-sync previous,
            let preEpoch = minEpochNumber-1;
            await FullBlock.sequelize.transaction(async (dbTx)=>{
                await Promise.all([
                    FullBlock.destroy({where:{epoch: preEpoch}, transaction: dbTx}),
                    FullTransaction.destroy({where:{epoch: preEpoch}, transaction: dbTx}),
                    AddressTransactionIndex.destroy({where:{epoch: preEpoch}, transaction: dbTx}),
                ])
            })
            const message = `pivot hash not match, current epoch ${minEpochNumber
                } = ${pivotBlock.hash}\n previous epoch ${preEpoch} = ${this.previousPivotHash}`
            console.log(`pivot switch detected: `, message)
            await this.resetPreviousPivotHash(preEpoch-1)
            return {code: CODE_REWIND, message}
        }
        let blockTime = new Date(pivotBlock.timestamp*1000);
        // build block template out of the transaction below.
        let pos = 0
        for (const block of blockList) {
            block.epoch = minEpochNumber
            block.pivot = false;
            const reward = minEpochNumber == 0 ? {} : rewardList.find(r=>r.blockHash === block.hash) || {}
            let minerBase32 = block.miner;
            let minerHex = format.hexAddress(minerBase32)
            //save address anyway, so use undefined transaction.
            const addrBean = await makeId(minerHex, undefined, {dt: blockTime})
            block.minerId = addrBean.id
            block.totalReward = reward.totalReward || 0;
            block.txFee = reward.txFee || 0;
            block.avgGasPrice = 0
            block.position = pos ++
            block.txCount = block.transactions.length // all txn, include packed but not executed
            if (minEpochNumber === 0) {
                block.gasUsed = 0
                // utc '2020-10-28 16:00:00' => '2020-10-29 00:00:00' gmt+8
                block.createdAt = new Date('2020-10-28T16:00:00.000Z')
            } else {
                block.createdAt = blockTime
            }
        }
        pivotBlock.pivot = true
        // build transaction template
        const executedTxArr = []
        const txByAddressArr = []
        for (const block of blockList) {
            let sumGasPrice = BigInt(0)
            let pos = 0
            for (const txInfo of block.transactions) {
                if (txInfo.status || txInfo.status === 0 || minEpochNumber === 0) {
                    txInfo.fromId = (await makeId(format.hexAddress(txInfo.from), undefined, {dt: blockTime})).id
                    txInfo.toId = txInfo.to && txInfo.to !== '0x' ?
                        (await makeId(format.hexAddress(txInfo.to), undefined, {dt: blockTime})).id : 0
                    txInfo.epoch = minEpochNumber
                    txInfo.blockPosition = block.position
                    txInfo.txPosition = pos++
                    txInfo.createdAt = block.createdAt
                    txInfo.dripValue = txInfo.value
                    if (txInfo.contractCreated && txInfo.contractCreated !== '0x') {
                        txInfo.contractCreatedId = (await makeId(format.hexAddress(txInfo.contractCreated), undefined, {dt: blockTime})).id
                    } else {
                        txInfo.contractCreatedId = 0
                    }
                    txInfo.status = minEpochNumber === 0 ? 0 : txInfo.status
                    executedTxArr.push(txInfo)
                    //speed up query transaction of one address
                    txInfo.addressId = txInfo.fromId
                    txByAddressArr.push(txInfo)
                    const dummyTo = txInfo.toId || txInfo.contractCreatedId
                    if (dummyTo && dummyTo !== txInfo.fromId) {
                        const clone = {...txInfo}
                        clone.addressId = dummyTo
                        txByAddressArr.push(clone)
                    }
                    sumGasPrice += txInfo.gasPrice
                }
            }
            block.executedTxnCount = pos
            pos && (block.avgGasPrice = sumGasPrice / BigInt(pos))
        }
        //
        await FullBlock.sequelize.transaction(async (dbTx) => {
            await Promise.all([
                FullBlock.bulkCreate(blockList, {transaction: dbTx}),
                FullTransaction.bulkCreate(executedTxArr, {transaction: dbTx}),
                AddressTransactionIndex.bulkCreate(txByAddressArr, {transaction: dbTx}),
            ])
        }).then(async ()=>{
            this.previousPivotHash = pivotBlock.hash
            this.metrics.executedTxCount += executedTxArr.length
            this.metrics.addressTxCount += txByAddressArr.length
            this.metrics.blockCount += blockList.length
            // console.log(`====`, blockList[0])
            const epochPerStat = 100
            if((minEpochNumber % epochPerStat) === 0) {
                let now = new Date().getTime();
                const elapse = now - this.metrics.ms
                console.info(`${fmtDtUTC(new Date())} insert block ${this.metrics.blockCount
                } tx ${this.metrics.executedTxCount} address's tx ${this.metrics.addressTxCount}, at epoch ${
                    minEpochNumber
                }, max block time ${blockTime.toISOString()}, cost ${elapse}ms`)
                this.metrics.ms = now
                this.metrics.executedTxCount = this.metrics.addressTxCount = this.metrics.blockCount = 0
                if ((minEpochNumber % 1000) === 0) {
                    const target = await this.cfx.getEpochNumber('latest_state')
                    const remainTime = (target - minEpochNumber) / epochPerStat * elapse
                    const targetTime:Date = new Date(now + remainTime)
                    console.log(`estimate target time ${targetTime.toISOString()}, ${target}, ${remainTime/1000/3600}h`)
                }
            }
        }).catch(err => {
            ok = false;
            message = `${err}`
            console.error(`sync blocks fail, min epoch ${minEpochNumber}.`, err)
            throw err;
        });
        return {
            code: ok ? 0 : 500, message, blockCount: blockList.length,
            epoch: minEpochNumber, executedTxnCount: executedTxArr.length
        };
    }
}
/*
SELECT TABLE_NAME,PARTITION_NAME,PARTITION_METHOD,PARTITION_EXPRESSION,PARTITION_DESCRIPTION,TABLE_ROWS,CREATE_TIME,UPDATE_TIME
       FROM INFORMATION_SCHEMA.PARTITIONS
       WHERE PARTITION_NAME is not null;

alter table full_block add column `executedTxnCount` bigint unsigned null  default null;

https://dev.mysql.com/doc/refman/5.7/en/partitioning-limitations-locking.html
ALTER TABLE ... TRUNCATE PARTITION prunes locks; only the partitions to be emptied are locked.
 */