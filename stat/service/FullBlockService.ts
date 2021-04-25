//@ts-ignore
import { Conflux, format } from "js-conflux-sdk";
import {AddressTransactionIndex, FullBlock, FullTransaction, IFullBlock} from "../model/FullBlock";
import { makeId } from "../model/HexMap";
import { fmtDtUTC } from "../model/Utils";
import { BlockAndMinerSync } from "./BlockAndMinerSync";

export class FullBlockService {
    public cfx: Conflux;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
    }

    public async run(always = false) {
        let maxEpoch:number = await FullBlock.max('epoch')
        if (isNaN(maxEpoch)) {
           maxEpoch = -1
        }
        let ret
        do {
            maxEpoch += 1
            ret = await this.syncBlockByEpoch(maxEpoch)
        } while (always)
        return ret
    }
    public async syncBlockByEpoch(minEpochNumber: number) {
        let hashes: string[];
        let rewardList: any[] = await this.cfx.getBlockRewardInfo(minEpochNumber);
        if (rewardList.length === 0 && minEpochNumber > 0) {
            return {code: BlockAndMinerSync.CODE_REWARD_NOT_READY, message: 'reward is empty.', epoch: minEpochNumber};
        }
        try {
            hashes = await this.cfx.getBlocksByEpochNumber(minEpochNumber);
        } catch (e) {
            console.log(`FullBlock: fetch blocks by epoch number fail, epoch ${minEpochNumber}.`, e)
            return;
        }
        let blockList: any/*IFullBlock*/[] = (await Promise.all(
            hashes.map(hash=>{
                return this.cfx.getBlockByHash(hash, true)
            })
        )) as IFullBlock[]
        
        if (rewardList.length < blockList.length && minEpochNumber > 0) {
            return {code: BlockAndMinerSync.CODE_REWARD_NOT_READY, message: 'reward not ready.', epoch: minEpochNumber};
        }
        if (blockList.length === 0) {
            return {
                code: 0, message: "block list is empty", blockCount: 0, epoch: minEpochNumber
            }
        }
        // blockList = blockList.reverse(); // turn to asc order.
        let ok = true;
        let message = "ok";
        // the last one is pivot block.
        let blockTime = new Date(blockList[blockList.length-1].timestamp*1000);
        // build block template out of the transaction below.
        let pos = 0
        for (const block of blockList) {
            block.epoch = minEpochNumber
            block.pivot = false;
            const reward = minEpochNumber == 0 ? 0 : rewardList.find(r=>r.blockHash === block.hash)
            let minerBase32 = block.miner;
            let minerHex = format.hexAddress(minerBase32)
            //save address anyway, so use undefined transaction.
            const addrBean = await makeId(minerHex, undefined, {dt: blockTime})
            block.minerId = addrBean.id
            block.totalReward = reward.totalReward;
            block.txFee = reward.txFee;
            block.avgGasPrice = block.transactions.length === 0 ? 0
                : block.transactions.map(t=>t.gasPrice).reduce((a,b)=>a+b, BigInt(0)) / BigInt(block.transactions.length);
            block.position = pos ++
            block.txCount = block.transactions.length
            if (minEpochNumber === 0) {
                block.gasUsed = 0
                // utc '2020-10-28 16:00:00' => '2020-10-29 00:00:00' gmt+8
                block.createdAt = new Date('2020-10-28T16:00:00.000Z')
            } else {
                block.createdAt = blockTime
            }
        }
        blockList[blockList.length-1].pivot = true
        // build transaction template
        const txArr = []
        const txByAddressArr = []
        for (const block of blockList) {
            let pos = 0
            for (const txInfo of block.transactions) {
                if (txInfo.status !== undefined && txInfo.status !== '') {
                    txInfo.fromId = (await makeId(format.hexAddress(txInfo.from), undefined, {dt: blockTime})).id
                    txInfo.toId = txInfo.to ?
                        (await makeId(format.hexAddress(txInfo.to), undefined, {dt: blockTime})).id : 0
                    txInfo.epoch = minEpochNumber
                    txInfo.blockPosition = block.position
                    txInfo.txPosition = pos++
                    txInfo.createdAt = block.createdAt
                    txInfo.dripValue = txInfo.value
                    if (txInfo.contractCreated) {
                        txInfo.contractCreatedId = (await makeId(format.hexAddress(txInfo.to), undefined, {dt: blockTime})).id
                    } else {
                        txInfo.contractCreatedId = 0
                    }
                    txInfo.status = minEpochNumber === 0 ? 0 : txInfo.status
                    txArr.push(txInfo)
                    //speed up query transaction of one address
                    txInfo.addressId = txInfo.fromId
                    txByAddressArr.push(txInfo)
                    const dummyTo = txInfo.toId || txInfo.contractCreatedId
                    if (dummyTo && dummyTo !== txInfo.fromId) {
                        const clone = {...txInfo}
                        clone.addressId = dummyTo
                        txByAddressArr.push(clone)
                    }
                }
            }
        }
        //
        await FullBlock.sequelize.transaction(async (dbTx) => {
            await FullBlock.bulkCreate(blockList, {transaction: dbTx});
            await FullTransaction.bulkCreate(txArr, {transaction: dbTx});
            await AddressTransactionIndex.bulkCreate(txByAddressArr, {transaction: dbTx});
        }).then(async ()=>{
            // console.log(`====`, blockList[0])
            ((minEpochNumber % 100) === 0) && console.info(`${fmtDtUTC(new Date())} insert block count ${blockList.length}, at epoch ${
                blockList[0].epochNumber
            }, max block time ${blockTime.toISOString()}`)
        }).catch(err => {
            ok = false;
            message = `${err}`
            console.error(`sync blocks fail, min epoch ${minEpochNumber}.`, err)
            throw err;
        });
        return {
            code: ok ? 0 : 500, message, blockCount: blockList.length,
            epoch: minEpochNumber, txCount: txArr.length
        };
    }
}