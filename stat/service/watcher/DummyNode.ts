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
    if (traceIndex === MINED_COUNT_AGGREGATE_SIZE) txIndex++, traceIndex = 0.
 */
const NodeCache = require( "node-cache" );
const dbCache = new NodeCache()
const cacheTtl = 60 * 50 // 50 minutes
import {Model,Sequelize,Op,DataTypes} from "sequelize";
// @ts-ignore
import {Conflux, Drip, format} from "js-conflux-sdk";
import {buildHexSet, fillHexId, makeId, makeIdV} from "../../model/HexMap";
import {init} from "../tool/FixDailyTokenStat";
import {createTable} from "../DBProvider";
import {PreloadMap} from "../SyncBase";

const DRIP_FACTOR = BigInt(1e+18)
const MINUS_DRIP_FACTOR = -BigInt(1e+18)
const STORAGE_DIV = BigInt(1024)
const ZERO_BIGINT = BigInt(0)
const ONE_BIGINT = BigInt(1)
const GAS = 'gas'
const STORAGE_USED = 'store_u'
const STORAGE_RELEASED = 'store_r'
const REWARD = 'reward'
const GENESIS = 'genesis'
const MINED_COUNT_AGGREGATE_SIZE = 1_000_000_000
export class DummyNode {
    cfx:Conflux
    verbose: boolean = false;
    stopAtEpoch = 0
    preLoadMap:PreloadMap
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.preLoadMap = new PreloadMap(this.fetchEpochRaw.bind(this))
    }
    log(tag, param, res){
        console.log(tag, param, typeof res)
        return res
    }
    minBalanceRecord:any = {balance:ZERO_BIGINT}
    async setupEpoch0() {
        await this.updateMaxEpochLimit()
        // @ts-ignore
        await this.cfx.updateNetworkId()
        // @ts-ignore
        const networkId = this.cfx.networkId;
        console.log(`network id ${networkId}`)
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

        if (networkId === 1029) {
            // cfx:acb59fk6vryh8dj5vyvehj9apzhpd72rdpwsc651kz four year
            await make('0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b', 42_0000_0000, 0)
            // cfx:ach9eg1rk28060m3kpw44np1znvn6p9ffjkk6651nb two year
            await make('0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a', 8_0000_0000, 1)
        } else if (networkId === 1) {
            // cfxtest:aathrdjwhfsjzt88577vz42r4hkh41vmt68xu9h4vc             50 0000 0000n
            await make('0x1e768d12395c8abfdedf7b1aeb0dd1d27d5e2a7f', 5000000000000000, 0)
            // cfxtest:aar8jzybzv0fhzreav49syxnzut8s0jt1a1pdeeuwb
            await make('0x1be45681ac6c53d5a40475f7526bac1fe7590fb8', 5000000000000000, 0)
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
    preFetchedTo = 0
    async fetchEpoch(epoch) {
        if (epoch+10 === this.preFetchedTo) {
            for(let i=1; i<=10; i++) {
                this.preLoadMap.start(++this.preFetchedTo)
            }
        }
        return this.preLoadMap.pop(epoch)
    }
    async fetchEpochRaw(epoch) {
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
        }).then(res=>{
            // console.log(`epoch detail:\n ${JSON.stringify(res)}`)
            return this.buildBill(epoch, res)
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
                if (!receipt && tx.status === null && tx.blockHash === null) {
                    console.log(`tx receipt not found, epoch ${epoch} block hash ${block.hash
                    }\n tx hash ${tx.hash} tx index ${txIndex}`)
                    continue
                }
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
                for (const [traceIndex,{action,type}] of transactionTraces[txIndex].traces.entries()) {
                    if (!action.value
                        || action.callType === 'none'
                        || action.callType === 'callcode'
                        || action.callType === 'delegatecall'
                        || action.callType === 'staticcall'
                    ) {
                        continue
                    }
                    // type is call, and only callType 'call' will transfer cfx.
                    if (action.callType !=='call' && type === 'call') {
                        console.log(`unknown call type ${action.callType} type ${type}, epoch ${epoch} block ${block.hash} tx ${txIndex}, trace ${traceIndex}`)
                        process.exit(8)
                        return
                    }
                    let tType = type
                    if (type === 'internal_transfer_action') {
                        tType = 'in_trans'
                    } else if (type === 'create' || type ==='call') {
                    } else if (type === 'create_result' || type ==='call_result') {
                        //value should be zero, won't trigger
                    } else {
                        console.log(`unknown trace type ${type}, epoch ${epoch} block ${block.hash} tx ${txIndex}, trace ${traceIndex}`)
                        process.exit(8)
                        return
                    }
                    if (type === 'create' && receipt.contractCreated && !action.to) {
                        action.to = receipt.contractCreated
                    }
                    if (action.from !== action.to) {
                        // if from eq to, then ignore, only care gas. other wise, the 'out' will cause negative result.
                        const traceBillFrom = {
                            owner:action.from, epoch, blockIndex, txIndex, traceIndex, type:tType,
                            from: action.from, to: action.to, diffDrip: -action.value, seq:billArr.length
                        };
                        billArr.push(traceBillFrom)
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
            this.addBalance(map.get(key), b)//?.balance || ZERO_BIGINT) + BigInt(b.diffDrip)
            if (b.balance < ZERO_BIGINT
                // && b.type !== GAS
                // && b.ownerId === 991
            ) {
                NegativeCfxBill.create(b)
                if (b.balance < this.minBalanceRecord.balance) {
                    this.minBalanceRecord = b
                }
                // console.log(`negative balance, owner ${b.ownerId}, epoch ${b.epoch
                // } type ${b.type} block ${b.blockIndex} tx ${b.txIndex} diff ${new Drip(-b.diffDrip).toCFX()
                // } balance ${new Drip(-b.balance).toCFX()}\n ${JSON.stringify(b)}`)
                // process.exit(0)
            }
            map.set(key, b) // multiple bills for one owner within an epoch.
            dbCache.set(key, b, cacheTtl)
        })
    }
    addBalance(pre:CfxBill, b) {
        if (pre) {
            // console.log(`type is ${typeof bill.balance}, ${bill.balance}`)
            b.balance = BigInt(pre.balance) + BigInt(b.diffDrip)
            if (b.type === REWARD) {
                if (pre.type === REWARD) {
                    b.traceIndex = pre.traceIndex + 1 // aggregate
                } else {
                    b.traceIndex = 1 // reset
                }
            }
        } else {
            b.balance = BigInt(b.diffDrip)
            b.traceIndex = 1 // mined block count
        }
    }
    async getPreBill(set:IterableIterator<number>) : Promise<Map<number,CfxBill>>{
        return await Promise.all([...set].map(async hexId=>{
            const cache = dbCache.get(hexId);
            if (cache) {
                dbCache.set(hexId, cache, cacheTtl)
                return cache
            }
            return CfxBill.findOne({where:{ownerId: hexId,}, order:[
                ['epoch','desc'],['seq','desc']], limit: 1}).then(res=>{
                    dbCache.set(hexId, res, cacheTtl)
                    return res
            })
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
        if (epoch >= this.stopAtEpoch) {
            await new Promise(r=>setTimeout(r, 5000))
            return
        }
        let base32idmapScope, preBillMapScope;
        return this.fetchEpoch(epoch)
        .then(bills=>{
            return this.prepareId(bills).then((base32idmap)=>{
                base32idmapScope = base32idmap
                return this.getPreBill(base32idmap.values())
            }).then(preBillMap=>{
                preBillMapScope = new Map(preBillMap)
                return {bills, preBillMap}
            })
        }).then(({bills, preBillMap})=>{
            return this.computeBalance(bills, preBillMap, o=>o.ownerId).then(()=>{
                return bills
            })
        }).then(bills=>{
            return CfxBill.bulkCreate(bills)
        }).then((bills)=> {
            if (!auto || epoch % 100 == 0) {
                const now = Date.now()
                const costMS = now - this.ms;
                this.ms = now
                const remainH = Math.ceil((this.stopAtEpoch - epoch) * costMS / 100 / 1000 / 3600)
                console.log(`${new Date().toISOString()} process epoch ${epoch} finished, create bills ${bills.length
                }, target epoch ${this.stopAtEpoch}, diff ${this.stopAtEpoch - epoch} ${remainH}H, min balance -${new Drip(-this.minBalanceRecord.balance).toCFX()
                }CFX owner ${this.minBalanceRecord.ownerId||'Empty'}`)
                this.updateMaxEpochLimit()
            }
            if (this.verbose) {
                // sync check
                return this.checkMiner(preBillMapScope, bills, epoch)
            } else {
                // async check
                this.checkMiner(preBillMapScope, bills, epoch)
            }
        })
    }
    ms = Date.now()
    async updateMaxEpochLimit() {
        this.cfx.getEpochNumber('latest_confirmed').then(res=>{
            this.stopAtEpoch = res - 1000
        })
    }
    // if the miner doesn't have tx in current epoch,
    // and previous record is a reward
    // and previous record epoch is greater than current epoch - 7200 (about 1 hour)
    // then delete previous record, to reduce table size.
    minerCounterMap = new Map<number, number>()
    async checkMiner(preBillMapScope, bills, epoch) {
        if (epoch % 10000 === 0) {
            // save point
            this.minerCounterMap.clear()
            return
        }
        const beyondRewardTxMiner = new Set<number>()
        for(const bill of bills) {
            if (bill.type !== REWARD) {
                beyondRewardTxMiner.add(bill.ownerId)
                if(this.verbose)console.log(`miner has tx, ${bill.ownerId}, ${bill.type}`)
            }
        }
        const toBeDel = []
        for(const bill of bills) {
            if (beyondRewardTxMiner.has(bill.ownerId)) {
                // this miner has tx in current epoch.
                if(this.verbose)console.log(`miner has tx, owner ${bill.ownerId} epoch ${bill.epoch}`)
                continue
            }
            const pre = preBillMapScope.get(bill.ownerId)
            if (pre === null || pre === undefined || pre.type !== REWARD) {
                // pre not found, or pre is not reward
                continue
            }
            // pre is reward
            const counter = this.minerCounterMap.get(bill.ownerId) || 0
            /** 0: keep, [1, N-1] delete, N keep, [1,N-1] delete, */
            if (counter === 0) {
                // keep first
                this.minerCounterMap.set(bill.ownerId, counter+1)
            } else /*if (counter < 100)*/ {
                // do not keep in DB
                // this.minerCounterMap.set(bill.ownerId, counter+1)
                // must not do deletion here, it will cause concurrent issues, counter will be mess up.
                toBeDel.push(pre)
            }/* else {
                // keep one, and reset counter.
                this.minerCounterMap.set(bill.ownerId, 1)
            }*/
        }

        let logIt = this.verbose ? console.log : false
        Promise.all(toBeDel.map(async pre=>{
            // inst.destroy() has wrong condition.
            CfxBill.destroy({ where: {ownerId: pre.ownerId, epoch: pre.epoch,
                    seq: {[Op.lte]:pre.seq}, type:REWARD, /*traceIndex: pre.traceIndex*/},
                logging: logIt,
            }).then(res=>{
                if (res === 0) {
                    // console.log(`delete fail, ${JSON.stringify(pre)}`)
                }
                if(this.verbose) console.log(`delete pre reward, owner ${pre.ownerId
                } cur epoch ${epoch} pre epoch ${pre.epoch}`);
            })
        })).then()
    }
}
if (require.main === module) {
    //
    const args = process.argv.slice(2)
    const args0 = args[0]
    //
    const node = new DummyNode(undefined)
    node.verbose = args.includes('verbose')
    let epoch;
    init().then(config=>{
        node.cfx = new Conflux(config.conflux)
        return node.setupEpoch0()
    }).then(res=>{
        return node.getEpochInDB()
    }).then(epochInDB=>{
        epoch = epochInDB + 1;
        node.preFetchedTo = epoch + 10
        if (args0) {
            return node.loop(epoch)
        } else {
            return node.processOne(epoch).then(()=>{
                return CfxBill.sequelize.close()
            }).then(()=>{
                process.exit(0)
            })
        }
    }).catch(err=>{
        console.log(`cfx bill fail, epoch ${epoch}:`, err)
        // return CfxBill.sequelize.close()
    })
}
//
export class NegativeCfxBill extends Model<ICfxBill> implements ICfxBill{
    id:number;
    ownerId:number; epoch:number; blockIndex:number; txIndex:number; traceIndex:number;
    type:string; fromId:number; toId:number; diffDrip:number; balance:number;
    seq:number;
    static register(seq:Sequelize) {
        NegativeCfxBill.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), primaryKey: true, autoIncrement: true},
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
            tableName: 'cfx_bill_negative',
            indexes:[
                {name:'balance', fields:[
                        {name: 'balance',},
                    ]}
            ]
        })
    }
}
export interface ICfxBill {
    id?:number,
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
            indexes:[
                {name:'PRIMARY', unique: true, fields:[
                        {name: 'ownerId',},
                        {name: 'epoch', order:"DESC"},
                        {name: 'seq', order:"DESC"},
                    ]}
            ]
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

/**
 select * from cfx_bill where balance < 0 and ownerId<>98 order by balance limit 10;
 select * from cfx_bill order by epoch,seq limit 10;
 select * from cfx_bill order by epoch desc,seq desc limit 10;
 select * from cfx_bill where ownerId=93 order by epoch,seq limit 10;  // lending 0x852dedfe1e87ed3d898552797df500008bd5b0b4
 select * from cfx_bill where ownerId=98 order by epoch,seq limit 10;  //zero
 select * from cfx_bill where ownerId=991 order by epoch,seq limit 10;
 select * from cfx_bill where ownerId=9197 order by epoch,seq limit 10;
 select * from cfx_bill where ownerId=61380 order by epoch,seq limit 10;
 select count(*) from cfx_bill where ownerId=61380 order by epoch,seq limit 10;
 select * from cfx_bill where ownerId=55118 order by epoch,seq limit 10;
 select * from cfx_bill where ownerId=61380 and balance <5e+18 order by epoch,seq limit 10;
 select * from cfx_bill where epoch=1 order by epoch,seq limit 10;

 select ownerId ,epoch  , seq  , blockIndex bi ,txIndex txI, traceIndex trI, type   , fromId , toId ,diffDrip , min(balance) as balance ,  balance/1e+18
 select ownerId ,min(balance) as balance ,  min(balance/1000000000000000000) as cfx, min(concat('0x',hex)) as hex
 from cfx_bill_negative join hex40 on cfx_bill_negative.ownerId=hex40.id
 group by ownerId
 order by balance  limit 12;

 select count(distinct(ownerId)) from cfx_bill_negative where balance < -1e+18;

 select ownerId ,epoch  , seq  , blockIndex bi ,txIndex txI, traceIndex trI, type   , fromId , hex  , diffDrip ,  balance/1e+18
 from cfx_bill b join hex40 on b.toId=hex40.id
 where ownerId=116884
 order by balance  limit 10;

 select sum(IF(fromId=702,-`value`,`value`)) from address_cfx_transfer where addressId=702 and epoch<=4113684;

 select * from hex40 where hex=''
 select id,concat('0x',hex) from hex40 where id=55118;
 select * from hex40 where id=52060;
 select * from hex40 where id=98;  // zero;
 select * from hex40 where id=61380;  //  0x1b19a334b7ed9726b7dc90e31283fb88248980b6

 select * from hex40 where hex=substring('0x17a18e4fd26ba60b7469a3a5ea259b33f594269a',3);
 select * from hex40 where hex=substring('0x8d5adbcaf5714924830591586f05302bf87f74bd',3);
 select * from hex40 where hex=substring('0x84404933832a6c7e01dfdf585be4b2debe1df830',3);

 select * from full_miner_block
 where minerId=1043 and epoch <= 232068
 order by epoch , position limit 0,10;

 select count(*) from block where minerId=1043 and epoch <= 232068;
 select count(*) from full_miner_block where minerId=1043 and epoch <= 232068;
 select count(*),sum(totalReward) from full_block where minerId=1043 and epoch <= 232068;
 select epoch,position from full_block where minerId=1043 and epoch <= 232068 and totalReward=6720297649002959231;

 !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 truncate table cfx_bill;
 */