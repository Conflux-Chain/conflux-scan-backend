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
 ownerId, epoch, seq, blockIndex, txIndex, traceIndex, type, fromId, toId, diffDrip, balance.
 big int,   bi,   bi,  bi,       uint,    uint,     char(8)  bi,     bi,  decimal(36)   dec36
 Types: gasFee, storage, transfer, reward.
 seq is the sequence in the epoch, used in `order by` when fetching the last record of one address.
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
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {buildHexSet, fillHexId, makeId, makeIdV} from "../../model/HexMap";
import {hex} from "../../test/GenData";
import {AddressCfxBill, T_ADDRESS_CFX_BILL_SQL} from "../../model/CfxTransfer";
import {init} from "../tool/FixDailyTokenStat";
import {createTable} from "../DBProvider";

const DRIP_FACTOR = BigInt(1e+18)
const STORAGE_DIV = BigInt(1024)
const ZERO_BIGINT = BigInt(0)
const ONE_BIGINT = BigInt(1)
const GAS = 'gas'
const STORAGE_USED = 'store_u'
const STORAGE_RELEASED = 'store_r'
const REWARD = 'reward'
const GENESIS = 'genesis'
export class DummyNode {
    cfx:Conflux
    constructor(cfx:Conflux) {
        this.cfx = cfx;
    }
    log(tag, param, res){
        console.log(tag, param, typeof res)
        return res
    }

    async setupEpoch0() {
        const anyOne = await CfxBill.findOne({})
        if (anyOne) {
            return
        }
        async function make(hex:string, ban, pos) {
            const idBean = await makeId(hex)
            return CfxBill.create({
                traceIndex: 0,
                ownerId: idBean.id,
                fromId: 0, toId: idBean.id,
                balance: ban * 1e+18,
                epoch: 0,
                seq: pos,
                type: GENESIS,
                blockIndex:0, txIndex: 0,
                diffDrip: ban * 1e+18
            })
        }

        // @ts-ignore
        const networdId = this.cfx.networdId;
        if (networdId === 1029) {
            // cfx:acb59fk6vryh8dj5vyvehj9apzhpd72rdpwsc651kz four year
            await make('0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b', 42_0000_0000, 0)
            // cfx:ach9eg1rk28060m3kpw44np1znvn6p9ffjkk6651nb two year
            await make('0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a', 8_0000_0000, 1)
        } else if (networdId === 1) {
            // cfxtest:aathrdjwhfsjzt88577vz42r4hkh41vmt68xu9h4vc
            await make('0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a', 50_0000_0000, 0)
        }
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
    makeStorageBill(billArr:any[], receipt:any, tx:any, epoch:number, txIndex:number, blockIndex:number) {
        // storage used
        if (!receipt.storageCoveredBySponsor && receipt.storageCollateralized) {
            const storageUsedBill = {
                owner:tx.from, epoch, blockIndex, txIndex, traceIndex: 0, type:'store_u',
                from: tx.from, to: tx.to, diffDrip: -this.computeStorageDrip(receipt.storageCollateralized),
                seq: billArr.length,
            }
            billArr.push(storageUsedBill)
        }
    }
    makeGasBill(billArr:any[], receipt:any, tx:any, epoch:number, txIndex:number, blockIndex:number) {
        // tx gas used
        if (!receipt.gasCoveredBySponsor && receipt.gasFee) {
            const gasBill = {
                owner:tx.from, epoch, blockIndex, txIndex, traceIndex: 0, type:GAS,
                from: tx.from, to: tx.to, diffDrip: -receipt.gasFee,
                seq: billArr.length,
            }
            billArr.push(gasBill)
        }
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
                if (receipt.outcomeStatus !== 0) {
                    // failed, only compute gas.
                    this.makeGasBill(billArr, receipt, tx, epoch, txIndex, blockIndex)
                    continue
                }
                // traces for this tx. traces is prior to gas and storage in one epoch.
                const transactionTraces = block.traces.transactionTraces;
                for (const [traceIndex,{action}] of transactionTraces[txIndex].traces.entries()) {
                    if (!action.value) {
                        continue
                    }
                    const traceBillFrom = {
                        owner:action.from, epoch, blockIndex, txIndex, traceIndex, type:'transfer',
                        from: action.from, to: action.to, diffDrip: -action.value, seq:billArr.length
                    };
                    billArr.push(traceBillFrom)
                    if (action.from !== action.to) {
                        const traceBillTo = {
                            ...traceBillFrom, owner: action.to, diffDrip: action.value, seq:billArr.length
                        }
                        billArr.push(traceBillTo)
                    }
                }
                this.makeStorageBill(billArr, receipt, tx, epoch, txIndex, blockIndex)
                // storage released
                for (const released of receipt.storageReleased) {
                    const releaseBill = {
                        owner:released.address, epoch, blockIndex, txIndex, traceIndex: 0, type:'store_r',
                        from: '', to: released.address, diffDrip: this.computeStorageDrip(released.collaterals),
                        seq:billArr.length
                    }
                    billArr.push(releaseBill)
                }
                this.makeGasBill(billArr, receipt, tx, epoch, txIndex, blockIndex)
            }
            const rewardBill = {
                owner:block.miner, epoch, blockIndex, txIndex:0, traceIndex: 0, type:REWARD,
                from: '', to: block.miner, diffDrip: block.reward.totalReward,
                seq:billArr.length
            }
            billArr.push(rewardBill)
        }
        return billArr
    }

    async computeBalance(billList:any[], map:Map<any,any>, keyMapper:(o:any)=>any) {
        // find previous record
        billList.forEach(b=>{
            const key = keyMapper(b);
            b.balance = this.addBalance(map.get(key), b.diffDrip)//?.balance || ZERO_BIGINT) + BigInt(b.diffDrip)
            map.set(b.owner, b) // multiple bills for one owner within an epoch.
        })
    }
    addBalance(bill:CfxBill, diff:bigint) {
        if (bill) {
            // console.log(`type is ${typeof bill.balance}, ${bill.balance}`)
            return BigInt(bill.balance) + diff
        } else {
            return diff
        }
    }
    async getPreBill(set:IterableIterator<number>) : Promise<Map<number,CfxBill>>{
        return await Promise.all([...set].map(async hexId=>{
            return CfxBill.findOne({where:{ownerId: hexId,}, order:[
                ['epoch','desc'],['seq','desc']], limit: 1})
        })).then(arr=>{
            const map = new Map<number, CfxBill>()
            arr.forEach(bill=>{
                bill && map.set(bill.ownerId, bill)
            })
            return map;
        })
    }
    async prepareId(billList:any[]) : Promise<Map<string, number>> {
        const set = buildHexSet(undefined, billList, 'owner')
        buildHexSet(set, billList, 'from')
        buildHexSet(set, billList, 'to')
        const base32idMap = new Map<string,number>()
        base32idMap.set('', 0)
        for (const base32 of set) {
            if (!base32) {
                continue
            }
            const hex = format.hexAddress(base32);
            const hexId = await makeIdV(hex);
            base32idMap.set(base32.substr(2), hexId)
            // console.log(`make id for ${base32}, hex ${hex} got id ${hexId}`)
        }
        fillHexId(base32idMap, billList, 'from', 'fromId')
        fillHexId(base32idMap, billList, 'to', 'toId')
        fillHexId(base32idMap, billList, 'owner', 'ownerId')
        //
        return base32idMap;
    }

    async getEpochInDB() {
        return CfxBill.findOne({order:[['epoch','desc']], limit: 1}).then(bill=>{
            return bill === null ? -1 : bill.epoch
        })
    }
    async loop(epoch, auto=false) {
        return this.processOne(epoch, auto).then(()=>{
            setTimeout(()=>this.loop(epoch+1, true), 0)
        }).catch(err=>{
            console.log(`error at epoch ${epoch}:`, err)
        })
    }
    async processOne(epoch, auto=false) {
        let base32idmapScope, preBillMapScope;
        return this.fetchEpoch(epoch)
        .then(res=>{
            // console.log(`epoch detail:\n ${JSON.stringify(res)}`)
            return this.buildBill(epoch, res)
        }).then(bills=>{
            return this.prepareId(bills).then((base32idmap)=>{
                base32idmapScope = base32idmap
                return this.getPreBill(base32idmap.values())
            }).then(preBillMap=>{
                preBillMapScope = preBillMap
                return {bills, preBillMap}
            })
        }).then(({bills, preBillMap})=>{
            return this.computeBalance(bills, preBillMap, o=>o.ownerId).then(()=>{
                return bills
            })
        }).then(bills=>{
            return CfxBill.bulkCreate(bills)
        }).then((bills)=> {
            this.checkMiner(base32idmapScope, preBillMapScope, bills)
            if (!auto || epoch % 100 == 0) {
                console.log(`${new Date().toISOString()} process epoch ${epoch} finished, create bills ${bills.length}`)
            }
        })
    }
    // if the miner doesn't have tx in current epoch,
    // and previous record is a reward
    // and previous record epoch is greater than current epoch - 7200 (about 1 hour)
    // the delete previous record, to reduce table size.
    async checkMiner(base32idmapScope, preBillMapScope, bills) {
        for(const bill of bills) {
            if (base32idmapScope.has(bill.from) || base32idmapScope.has(bill.to)) {
                // has tx in current epoch
                continue
            }
            const pre = preBillMapScope.get(bill.ownerId)
            if (pre === null || pre.type !== REWARD || bill.epoch - pre.epoch < 7200) {
                // pre not found, or pre is not reward, or pre is too close to current
                continue
            }
            pre.destroy()
        }
    }
}
if (require.main === module) {
    const cfx = new Conflux({
        url: 'http://47.242.194.209:12537',
        networkId: 2
    });
    const node = new DummyNode(cfx)
    let epoch;
    init().then(config=>{
        return node.setupEpoch0()
    }).then(res=>{
        return node.getEpochInDB()
    }).then(epochInDB=>{
        epoch = epochInDB + 1;
        // return node.processOne(epoch)
        return node.loop(epoch)
    }).catch(err=>{
        console.log(`cfx bill fail, epoch ${epoch}:`, err)
        // return CfxBill.sequelize.close()
    })
}
export interface ICfxBill {
    ownerId:number, epoch:number, blockIndex:number, txIndex:number, traceIndex:number,
    type:string, fromId:number, toId:number, diffDrip:number, balance:number,
    seq:number;
}
const T_CFX_BILL = 'cfx_bill'
export class CfxBill extends Model<ICfxBill> implements ICfxBill{
    ownerId:number; epoch:number; blockIndex:number; txIndex:number; traceIndex:number;
    type:string; fromId:number; toId:number; diffDrip:number; balance:number;
    seq:number;
    static register(seq:Sequelize) {
        console.log(`reg cfx bill`)
        CfxBill.init({
            ownerId: {type: DataTypes.BIGINT({unsigned: true})},
            epoch: {type: DataTypes.BIGINT({unsigned: true})},
            seq: {type: DataTypes.INTEGER({unsigned: true})},
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
            tableName: T_CFX_BILL,
        })
    }
}
const T_CFX_BILL_SQL = `
create table if not exists cfx_bill
(
ownerId bigint unsigned not null,
epoch bigint unsigned not null,
seq int unsigned not null,
blockIndex bigint unsigned not null,
txIndex int unsigned not null,
traceIndex int unsigned not null,
type char(8) null,
fromId bigint unsigned not null,
toId bigint unsigned not null,
diffDrip decimal(36) not null,
balance decimal(36) not null,
primary key (ownerId,epoch desc,seq desc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8
partition by hash (ownerId)
  PARTITIONS 97;
`

export async function createV2CfxBillTable(seq:Sequelize) {
    return createTable(seq, T_CFX_BILL_SQL)
        .then(()=>{
            return CfxBill.register(seq)
        }).then(()=>{
            console.log(`createV2CfxBillTable remove id.`)
            CfxBill.removeAttribute("id")
        }).catch(err=>{
            console.log(`createCfxTransferTable fail, sql ${T_CFX_BILL_SQL}:`, err)
            process.exit(9)
        })
}