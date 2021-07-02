/**
Compute:
 1 gasFee in tx receipt (failed/successful).
 2 storage collateral(used/released) in tx receipt (successful).
    formula: collateral / 1024 cfx
 3 transfer in block trace, corresponding tx must be successful.
   includes case: Destroying contract, sponsor refund.
 4 block reward for miner.

Fetch data:
 1 epoch -> block hash
 2 block detail ( tx -> receipt )
 3 block trace ( transfer )
 4 block reward

Bill struct:
 ownerId, epoch, blockIndex, txIndex, traceIndex, type, fromId, toId, diffDrip, balance.
 big int,   bi,    bi,       uint,    uint,     char(8)  bi,     bi,  decimal(36)   dec36
 Types: gasFee, storage, transfer, reward.
 -
 */
/**
 Aggregate reward:
 if the previous record of the miner is also a reward, then aggregate.
 In this case, the fromId is the epoch from which the aggregation begin.
 We can save the total number of blocks one miner mined, split to txIndex and traceIndex.
    if (traceIndex === 4294967295(2^32-1)) txIndex++, traceIndex = 0.
 */
import {Model,Sequelize,Op,DataTypes} from "sequelize";
import {Conflux} from "js-conflux-sdk";

const DRIP_FACTOR = BigInt(1e+18)
const STORAGE_DIV = BigInt(1024)
const ZERO_BIGINT = BigInt(0)
export class DummyNode {
    cfx:Conflux
    constructor(cfx:Conflux) {
        this.cfx = cfx;
    }
    log(tag, param, res){
        console.log(tag, param, typeof res)
        return res
    }

    async fetchBlockDetail(hash) : Promise<any> {
        // console.log(`fetch detail `)
        return await Promise.all([
            this.cfx.traceBlock(hash),//.then(res=>this.log('trace', hash, res)),
            this.cfx.getBlockByHash(hash, true).then(block=>{
                return Promise.all(
                    block['transactions'].map(async tx=>{
                        return this.cfx.getTransactionReceipt(tx.hash).then(receipt=>{
                            tx.receipt = receipt
                        })
                    })
                ).then(()=>{
                    return block
                })
            }),
        ]).then( ([traces, block])=>{
            // @ts-ignore
            block.traces = traces
            return block
        })
    }
    async fetchEpoch(epoch) {
        return Promise.all([
            this.cfx.getBlocksByEpochNumber(epoch).then(async hashes=>{
                // console.log(`hashes: \n ${hashes.join('\n')}`)
                return Promise.all(
                    hashes.map(async hash=>{
                        return this.fetchBlockDetail(hash)//.then(res=>this.log('fetch done ', hash, res))
                    })
                ).then(blockDetailArray=>{
                    return blockDetailArray
                })
            }),
            this.cfx.getBlockRewardInfo(epoch),
        ]).then(([blockList,rewardList])=>{
            // console.log(`fetch all done.`)
            blockList.forEach((blk,idx)=>{
                blk.reward = rewardList[idx]
                if (blk.reward.author !== blk.miner) {
                    throw new Error(`block miner doesn't match reward author.\n${
                        blk.miner}\n${blk.reward.author}`)
                }
            })
            return blockList
        })
    }
    computeStorageDrip(unit) {
        const mulV = BigInt(unit) * DRIP_FACTOR
        if (mulV % STORAGE_DIV !== ZERO_BIGINT) {
            throw new Error(`storage computing results float, ${unit}`)
        }
        return mulV / STORAGE_DIV
    }
    async buildBill(epoch, blockList:any[]) {
        const billArr = []
        for (const [blockIndex,block] of blockList.entries()) {
            for (const [txIndex,tx] of block.transactions.entries()) {
                const receipt = tx.receipt
                if (receipt.epochNumber !== epoch) {
                    // not executed in current epoch
                    continue
                }
                // tx gas used
                if (!receipt.gasCoveredBySponsor && receipt.gasFee) {
                    const gasBill = {
                        owner:tx.from, epoch, blockIndex, txIndex, traceIndex: 0, type:'gas',
                        from: tx.from, to: tx.to, diffDrip: -receipt.gasFee,
                    }
                    billArr.push(gasBill)
                }
                if (receipt.outcomeStatus !== 0) {
                    // failed, only compute gas.
                    continue
                }
                // storage used
                if (!receipt.storageCoveredBySponsor && receipt.storageCollateralized) {
                    const storageUsedBill = {
                        owner:tx.from, epoch, blockIndex, txIndex, traceIndex: 0, type:'store_u',
                        from: tx.from, to: tx.to, diffDrip: -this.computeStorageDrip(receipt.storageCollateralized),
                    }
                    billArr.push(storageUsedBill)
                }
                // storage released
                for (const released of receipt.storageReleased) {
                    const releaseBill = {
                        owner:released.address, epoch, blockIndex, txIndex, traceIndex: 0, type:'store_r',
                        from: '', to: released.address, diffDrip: this.computeStorageDrip(released.collaterals),
                    }
                    billArr.push(releaseBill)
                }
                // traces for this tx
                const transactionTraces = block.traces.transactionTraces;
                for (const [traceIndex,{action}] of transactionTraces[txIndex].traces.entries()) {
                    if (!action.value) {
                        continue
                    }
                    const traceBillFrom = {
                        owner:action.from, epoch, blockIndex, txIndex, traceIndex, type:'transfer',
                        from: action.from, to: action.to, diffDrip: -action.value,
                    };
                    billArr.push(traceBillFrom)
                    if (action.from !== action.to) {
                        const traceBillTo = {
                            ...traceBillFrom, owner: action.to, diffDrip: action.value,
                        }
                        billArr.push(traceBillTo)
                    }
                }
            }
            const rewardBill = {
                owner:block.miner, epoch, blockIndex, txIndex:0, traceIndex: 0, type:'reward',
                from: '', to: block.miner, diffDrip: block.reward.totalReward,
            }
            billArr.push(rewardBill)
        }
        return billArr
    }

}
if (require.main === module) {
    const cfx = new Conflux({
        url: '',
        networkId: 2
    });
    const node = new DummyNode(cfx)
    const epoch = 2459733;
    node.fetchEpoch(epoch).then(res=>{
        console.log(`epoch detail:\n ${JSON.stringify(res)}`)
        return node.buildBill(epoch, res)
    }).then(bills=>{
        bills.forEach(b=>{
            b.from = b.from.substr(10,8)
            b.to = b.to.substr(10,8)
            b.owner = b.owner.substr(10,8)
        })
        console.log(`bills:\n${bills.map(b=>JSON.stringify(b)).join('\n')}`)
    })
}
export interface ICfxBill {
    ownerId:number, epoch:number, blockIndex:number, txIndex:number, traceIndex:number,
    type:string, fromId:number, toId:number, diffDrip:number, balance:number
}
export class CfxBill extends Model<ICfxBill> implements ICfxBill{
    ownerId:number; epoch:number; blockIndex:number; txIndex:number; traceIndex:number;
    type:string; fromId:number; toId:number; diffDrip:number; balance:number
    static register(seq:Sequelize) {
        CfxBill.init({
            ownerId: {type: DataTypes.BIGINT({unsigned: true})},
            epoch: {type: DataTypes.BIGINT({unsigned: true})},
            blockIndex: {type: DataTypes.BIGINT({unsigned: true})},
            txIndex: {type: DataTypes.INTEGER({unsigned: true})},
            traceIndex: {type: DataTypes.INTEGER({unsigned: true})},
            type: {type: DataTypes.CHAR(8)},
            fromId: {type: DataTypes.BIGINT({unsigned: true})},
            toId: {type: DataTypes.BIGINT({unsigned: true})},
            diffDrip: {type: DataTypes.DECIMAL(36, 0)},
            balance: {type: DataTypes.DECIMAL(36, 0)},
        },{
            sequelize: seq,
            timestamps: false,
        })
    }
}