//@ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {
    AddressTransactionIndex,
    BLOCK_PAGE_MARK_SIZE,
    BlockRowMark,
    countNonMarkBlockRows,
    countNonMarkTxRows, FailedTx,
    FullBlock,
    FullTransaction,
    IBlockRowMark, IFailedTx,
    IFullBlock,
    ITxnRowMark, LEN_txExecErrorMsg,
    markBlockPosition,
    markTxPosition,
    TxnRowMark
} from "../model/FullBlock";
import {Hex40Map, makeId} from "../model/HexMap";
import {fmtDtUTC} from "../model/Utils";
import {Transaction,QueryTypes,UniqueConstraintError} from "sequelize"
import {
    KEY_FILL_BLOCK_PROPS_EPOCH,
    KEY_FILL_BLOCK_REWARD_EPOCH,
    KEY_FULL_BLOCK_COUNT,
    KEY_FULL_TX_COUNT,
    KV
} from "../model/KV";
import {PreloadMap} from "./SyncBase";
import {Epoch} from "../model/Epoch";


// Do not care the value
const CODE_REWIND = 20201029
const CODE_OK = 0
const CODE_CONTINUE = 2020102903
const CODE_EMPTY_BLOCK = 2020102907
export class FullBlockService {
    public cfx: Conflux;
    public debugLog:boolean = true
    preLoadMap:PreloadMap
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.preLoadMap = new PreloadMap(this.loadEpochData.bind(this))
    }
    // sync metrics
    private metrics = {
        ms : 0,
        executedTxCount : 0,
        addressTxCount: 0,
        blockCount: 0,
        //
        queryFullNodeTime: 0,
        buildTime: 0,
        saveBlockTime: 0,
        saveTxTime: 0,
        saveAddrTxTime: 0,
        diffBlockCntTime: 0,
        diffTxCntTime: 0,
    }
    // sync metrics end
    private previousPivotHash:string
    public checkReOrg = true

    private async resetPreviousPivotHash(useWhichEpoch:number) {
        let maxAtDb = await FullBlock.findOne({
            where: {epoch: useWhichEpoch, pivot: true}
        });
        this.debugLog && console.log(`use max block ${maxAtDb.epoch} ${maxAtDb.hash}`)
        this.previousPivotHash = maxAtDb.hash
    }
    public async run(always = false) : Promise<void> {
        let maxEpoch:number = await FullBlock.max('epoch')
        if (isNaN(maxEpoch)) {
           maxEpoch = -1 // plus 1 got 0
        } else {
            await this.resetPreviousPivotHash(maxEpoch)
        }
        await this.checkBlockCountKV()
        await this.checkTxCountKV()
        const that = this
        async function repeat(){
            let ret
            ret = await that.syncBlockByEpoch(maxEpoch+1).catch(err=>{
                const errStr = `${err}`
                if (errStr.includes('Lock wait timeout exceeded;')) {
                    console.log(`lock time out at epoch ${maxEpoch}:`, err)
                } else {
                    console.log(`sync block fail at epoch ${maxEpoch}`, err)
                }
                return {code: CODE_CONTINUE}
            })
            if (ret.code === CODE_REWIND) {
                maxEpoch -= 1;
            } else if (ret.code === CODE_CONTINUE) {
                // try again
                that.debugLog && process.stdout.write(`\r ${new Date().toISOString()} try again: ${ret.message}`)
                await new Promise(r=>setTimeout(r, 1000))
            } else if (ret.code === CODE_EMPTY_BLOCK) {
                that.debugLog && process.stdout.write(`\r ${new Date().toISOString()} empty block at epoch ${ret.epoch}, ${ret.message}`)
                await new Promise(r=>setTimeout(r, 1000))
            } else {
                maxEpoch += 1
            }
            if ( maxEpoch % BLOCK_PAGE_MARK_SIZE === 0 && maxEpoch > BLOCK_PAGE_MARK_SIZE) {
                let avoidReOrg = 1000;
                Promise.all([
                    markTxPosition(BLOCK_PAGE_MARK_SIZE, maxEpoch - avoidReOrg),
                    markBlockPosition(BLOCK_PAGE_MARK_SIZE, maxEpoch - avoidReOrg)
                ]).then()
            }
            if (always) {
                setTimeout(repeat, 0)
            }
        }
        return repeat()
    }

    public async checkTxCountKV() {
        const cnt = await KV.getNumber(KEY_FULL_TX_COUNT)
        if (!isNaN(cnt)) {
            console.log(`tx count in KV: ${cnt}`)
            return
        }
        let maxOne:ITxnRowMark = await TxnRowMark.findOne({order: [["id", "desc"]], limit: 1})
        if (maxOne === null) {
            maxOne = {id:0, epoch:-1, blockPosition:-1, txPosition: -1}
        }
        const nonMarkRows = await countNonMarkTxRows(maxOne)
        const countNow = nonMarkRows + maxOne.id;
        console.log(`create full txn count KV: ${countNow}, non mark rows: ${nonMarkRows}`)
        return KV.create({key: KEY_FULL_TX_COUNT, value: countNow.toString()})
    }
    public async checkBlockCountKV() {
        const cnt = await KV.getNumber(KEY_FULL_BLOCK_COUNT)
        if (!isNaN(cnt)) {
            console.log(`block count in KV: ${cnt}`)
            return
        }
        const maxBlock = await FullBlock.findOne({order:[['epoch','desc']]})
        if (maxBlock === null) {
            return KV.create({key: KEY_FULL_BLOCK_COUNT, value: '0'})
        }
        if (maxBlock.epoch < BLOCK_PAGE_MARK_SIZE) {
            // The system may just starts, has a few records.
            let countNow = (await FullBlock.count()).toString();
            console.log(`set block count to ${countNow}, as system just starts.`);
            return KV.create({key: KEY_FULL_BLOCK_COUNT, value: countNow});
        }
        let maxOne:IBlockRowMark = await BlockRowMark.findOne({order: [["id", "desc"]], limit: 1})
        if (maxOne === null) {
            maxOne = {id:0, epoch:-1, position: -1}
        }
        const nonMarkRows = await countNonMarkBlockRows(maxOne)
        const countNow = nonMarkRows + maxOne.id;
        console.log(`create full block count KV: ${countNow}, non mark rows: ${nonMarkRows}`)
        return KV.create({key: KEY_FULL_BLOCK_COUNT, value: countNow.toString()})
    }
    private async loadEpochData(minEpochNumber: number) {
        const [rewardList, hashes, latest_state] = await Promise.all([
            this.cfx.getBlockRewardInfo(minEpochNumber).catch(async err=>{
                const msg = `${err}`
                if (msg.includes('expected a numbers with less than largest epoch number.')) {
                    // https://developer.conflux-chain.org/docs/conflux-doc/docs/json_rpc/#the-epoch-number-parameter
                    // const latest = await this.cfx.getEpochNumber('latest_state') // for the latest epoch that has been executed.
                    // console.log(`latest_state ${latest}`)
                } else {
                    console.log(`get reward info fail at epoch ${minEpochNumber}: ${msg}`)
                }
                return [];
            }),
            this.cfx.getBlocksByEpochNumber(minEpochNumber).catch(err=>{
                const msg = `${err}`
                if (msg.includes('expected a numbers with less than largest epoch number.')) {

                } else {
                    console.log(`FullBlock: fetch blocks by epoch number fail, epoch ${minEpochNumber}.`, err)
                }
                return []
            }),
            this.cfx.getEpochNumber('latest_state'),
        ])
        if (latest_state < minEpochNumber) {
            return {code:CODE_CONTINUE, message: `block not ready, want ${minEpochNumber} > ${latest_state} latest_state`}
        }
        if (hashes.length === 0) {
            return {
                code: CODE_EMPTY_BLOCK, message: "block list is empty", blockCount: 0, epoch: minEpochNumber
            }
        }
        let blockList: any/*IFullBlock*/[] = (await Promise.all(
            (hashes as []).map(hash=>{
                return this.cfx.getBlockByHash(hash, true)
            })
        )) as IFullBlock[]
        return {code: 0, message: 'ok', blockList, rewardList, latest_state}
    }
    async buildHexIds(blockList, dt:Date) : Promise<Map<string, number>> {
        const map = new Set<string>()
        for (const block of blockList) {
            for (const txInfo of block.transactions) {
                if (!map.has(txInfo.from)) {
                    map.add(txInfo.from)
                }
                if (txInfo.to && txInfo.to !== '0x' && txInfo.to !== txInfo.from) {
                    map.add(txInfo.to)
                }
                if (txInfo.contractCreated && txInfo.contractCreated !== '0x') {
                    map.add(txInfo.contractCreated)
                }
            }
        }
        const templates = []
        const base32arr =  []
        map.forEach(base32=>{
            templates.push(makeId(format.hexAddress(base32), undefined, {dt}));
            base32arr.push(base32)
        })
        return Promise.all(templates).then(hexArr=> {
            const map = new Map<string, number>()
            hexArr.forEach( (bean,idx) => {
                // console.log(`build id ${templates[idx].base32} == ${bean.hex} == ${bean.id}`)
                map.set(base32arr[idx], bean.id)
            })
            return map;
        })
    }
    async syncFailedTx(epoch, blockPos, txPos, hash) : Promise<IFailedTx|null> {
        return FullBlockService.syncFailedTx0(epoch, blockPos, txPos, hash, this.cfx)
    }
    public static async syncFailedTx0(epoch, blockPos, txPos, hash, cfx:Conflux) : Promise<IFailedTx|null> {
        return cfx.getTransactionReceipt(hash).then(receipt=>{
            if (receipt) {
                let msg = receipt["txExecErrorMsg"] || '';
                if (msg.length >= LEN_txExecErrorMsg) {
                    msg = msg.substr(0, LEN_txExecErrorMsg-4)
                }
                if (receipt["epochNumber"] != epoch) {
                    console.log(`\n epoch doesn't match, ${epoch} ${hash} , receipt ${receipt["epochNumber"]}\n`)
                    return null
                }
                return {epoch, blockPosition: blockPos, txPosition: txPos,
                gasFee: receipt["gasFee"], txExecErrorMsg: msg}
            }
            return null
        })
    }
    public async syncBlockByEpoch(minEpochNumber: number) : Promise<{code:number, message?:string, blockCount?:number, epoch?:number,executedTxnCount?:number}> {
        let start = Date.now()
        let veryBegin = start
        let preLoadResult = await this.preLoadMap.pop(minEpochNumber)
        let now = Date.now();
        let metrics = this.metrics;
        metrics.queryFullNodeTime += now - start;  start = now; // =====================================================
        if (preLoadResult.code !== 0) {
            return preLoadResult
        }
        if (preLoadResult.latest_state - minEpochNumber > 500) {
            for (let i=1; i<=10; i++) {
                this.preLoadMap.start(minEpochNumber + i)
            }
        }
        // blockList = blockList.reverse(); // turn to asc order.
        const blockList = preLoadResult.blockList
        const rewardList = preLoadResult.rewardList
        let ok = true;
        let message = "ok";
        // the last one is pivot block.
        let pivotBlock = blockList[blockList.length-1];
        if (pivotBlock.parentHash !== this.previousPivotHash && minEpochNumber > 0 && this.checkReOrg) {
            // pivot switch, pop and re-sync previous,
            let preEpoch = minEpochNumber-1;
            const addresses = new Set<number>();
            const [popTx,popBlockCount] = await Promise.all([
                FullTransaction.findAll({where: {epoch: preEpoch}}),
                FullBlock.count({where:{epoch: preEpoch}})
            ])
            popTx.forEach(tx=>{
                addresses.add(tx.fromId)
                addresses.add(tx.toId)
            })
            await FullBlock.sequelize.transaction(async (dbTx)=>{
                await Promise.all([
                    FailedTx.destroy({where:{epoch:preEpoch}}),
                    FullBlock.destroy({where:{epoch: preEpoch}, transaction: dbTx}),
                    FullTransaction.destroy({where:{epoch: preEpoch}, transaction: dbTx}),
                    AddressTransactionIndex.destroy({
                        where:{epoch: preEpoch, addressId: [...addresses],},
                        transaction: dbTx}),
                    this.diffCount(KEY_FULL_BLOCK_COUNT, -popBlockCount, dbTx),
                    this.diffCount(KEY_FULL_TX_COUNT, -popTx.length, dbTx),
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
                block.gasUsed = block.gasUsed || 0
            }
        }
        pivotBlock.pivot = true
        // build transaction template
        const hexMap = await this.buildHexIds(blockList, blockTime);
        const executedTxArr = []
        const txByAddressArr = []
        const failedTxArr = []
        for (const block of blockList) {
            let sumGasPrice = BigInt(0)
            let pos = 0
            for (const txInfo of block.transactions) {
                // status has value, fail (!0) or success (0) or genesis epoch.
                if (txInfo.status || txInfo.status === 0 || minEpochNumber === 0) {
                    txInfo.fromId = hexMap.get(txInfo.from) || 0
                    txInfo.toId =  hexMap.get(txInfo.to) || 0
                    txInfo.contractCreatedId = hexMap.get(txInfo.contractCreated) || 0
                    txInfo.epoch = minEpochNumber
                    txInfo.blockPosition = block.position
                    txInfo.txPosition = pos++
                    txInfo.createdAt = block.createdAt
                    txInfo.dripValue = txInfo.value
                    txInfo.status = minEpochNumber === 0 ? 0 : txInfo.status
                    txInfo.method = txInfo.data.substr(0, 10)
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
                if (txInfo.status) { // has value and is not zero: failed.
                    failedTxArr.push(this.syncFailedTx(minEpochNumber, txInfo.blockPosition, txInfo.txPosition, txInfo.hash))
                }
            }
            block.executedTxnCount = pos
            pos && (block.avgGasPrice = sumGasPrice / BigInt(pos))
        }
        const failedBeans = await Promise.all(failedTxArr)
        now = Date.now();    metrics.buildTime += now - start;  start = now; // =============================
        let fixDupError = false
        //
        await FullBlock.sequelize.transaction(async (dbTx) => {
            await Promise.all([
                FailedTx.bulkCreate(failedBeans, {transaction: dbTx}),
                FullBlock.bulkCreate(blockList, {transaction: dbTx}).then(()=>metrics.saveBlockTime += Date.now() - start),
                FullTransaction.bulkCreate(executedTxArr, {transaction: dbTx}).then(()=>metrics.saveTxTime += Date.now() - start),
                AddressTransactionIndex.bulkCreate(txByAddressArr, {transaction: dbTx}).then(()=>metrics.saveAddrTxTime += Date.now() - start),
                this.diffCount(KEY_FULL_BLOCK_COUNT, blockList.length, dbTx).then(()=>metrics.diffBlockCntTime += Date.now() - start),
                this.diffCount(KEY_FULL_TX_COUNT, executedTxArr.length, dbTx).then(()=>metrics.diffTxCntTime += Date.now() - start),
            ])
        }).then(async ()=>{
            let now = Date.now()
            metrics.ms += now - veryBegin
            this.previousPivotHash = pivotBlock.hash
            metrics.executedTxCount += executedTxArr.length
            metrics.addressTxCount += txByAddressArr.length
            metrics.blockCount += blockList.length
            // console.log(`====`, blockList[0])
            const epochPerStat = 100
            if((minEpochNumber % epochPerStat) === 0) {
                console.info(`\r\u001b[2K${fmtDtUTC(new Date())} block ${metrics.blockCount
                } tx ${metrics.executedTxCount} (${metrics.addressTxCount}), epoch ${
                    minEpochNumber
                }, time ${blockTime.toISOString()}, cost ${metrics.ms}ms (full node ${metrics.queryFullNodeTime
                    } build ${metrics.buildTime} block ${metrics.saveBlockTime} all tx ${metrics.saveTxTime} addr tx ${metrics.saveAddrTxTime
                    } upBlkCnt ${metrics.diffBlockCntTime} upTxCnt ${metrics.diffTxCntTime})   `)
                if ((minEpochNumber % 1000) === 0) {
                    const target = await this.cfx.getEpochNumber('latest_state')
                    const remainTime = (target - minEpochNumber) / epochPerStat * (metrics.ms)
                    const targetTime:Date = new Date(now + remainTime)
                    console.log(`estimate target time ${targetTime.toISOString()}, ${target}, ${remainTime/1000/3600}h`)
                }
                metrics.executedTxCount = metrics.addressTxCount = metrics.blockCount = metrics.ms = 0;
                metrics.queryFullNodeTime = metrics.buildTime = metrics.saveBlockTime = metrics.saveTxTime = metrics.saveAddrTxTime = 0;
                metrics.diffTxCntTime = metrics.diffBlockCntTime = 0
            }
        }).catch(err => {
            ok = false;
            if (err instanceof UniqueConstraintError) {
                console.log(`Known issue, UniqueConstraintError error:`, err.message)
                fixDupError = true
            } else {
                message = `${err}`
                console.error(`sync blocks fail, min epoch ${minEpochNumber}.`, err)
                throw err;
            }
        });
        if (fixDupError) {
            await Promise.all([txByAddressArr.map( async tx=>AddressTransactionIndex.destroy({
                where: {addressId: tx.addressId, epoch: tx.epoch}}))]
            ).then(()=>{
                console.log(`fix dup error, ok. ${minEpochNumber}`)
            }).catch(err=>{
                console.log(`fix dup error fail , ${minEpochNumber} : `, err)
            })
            return {code: CODE_CONTINUE, message: `continue after fix UniqueConstraintError, ${minEpochNumber}.`}
        }
        return {
            code: ok ? 0 : 500, message, blockCount: blockList.length,
            epoch: minEpochNumber, executedTxnCount: executedTxArr.length
        };
    }
    async diffCount(key:string, diff:number, dbTx:Transaction) {
        const sql = "update config set `value` = ? + cast(`value` as unsigned) where `key`=?"
        return KV.sequelize.query(sql,
            {type: QueryTypes.UPDATE, replacements: [diff, key],
                transaction: dbTx})
    }
    public async fillBlockRewardByPos() {
        let prePos = await KV.getNumber(KEY_FILL_BLOCK_REWARD_EPOCH)
        if (isNaN(prePos)) {
            prePos = 0 // epoch 0 does not have reward.
        }
        console.log(`begin fill block reward at epoch ${prePos+1}`)
        let goOn = true
        do {
            const fillRet = await this.fillBlockReward(prePos+1).catch(err=>{
                console.log(`fill block reward fail, epoch ${prePos+1}`, err)
                return {code:CODE_CONTINUE, message:'error'}
            })
            process.stdout.write(`\r ${new Date().toISOString()} fill block reward at epoch ${prePos+1} return ${
                fillRet.code}, ${fillRet.message}`)
            switch (fillRet.code) {
                case CODE_CONTINUE:
                    await new Promise(r=>setTimeout(r, 5000))
                    break;
                case CODE_OK:
                    prePos += 1
                    await KV.upsert({value: prePos.toString(), key: KEY_FILL_BLOCK_REWARD_EPOCH})
                    if (prePos % 200 === 0) {
                        console.log(`\r\u001b[2K${new Date().toISOString()} Fill block reward to epoch ${prePos}`)
                    }
                    break;
                default:
                    console.log(`fill block reward return invalid result:`, fillRet)
                    goOn = false
                    break;
            }
        } while (goOn)
    }
    public async fillBlockReward(epoch) : Promise<{code:number, message:string}>{
        const [reward, latestConfirm, maxEpochOfBlock] = await Promise.all([
            this.cfx.getBlockRewardInfo(epoch).catch(async err=>{
                const msg = `${err}`
                if (msg.includes('expected a numbers with less than largest epoch number.')) {
                    // https://developer.conflux-chain.org/docs/conflux-doc/docs/json_rpc/#the-epoch-number-parameter
                    // const latest = await this.cfx.getEpochNumber('latest_state') // for the latest epoch that has been executed.
                    // console.log(`latest_state ${latest}`)
                } else {
                    console.log(`fillBlockReward get reward info fail at epoch ${epoch}: ${msg}`)
                }
                return [];
            }),
            this.cfx.getEpochNumber('latest_confirmed'),
            FullBlock.max('epoch')
        ])
        if (epoch > latestConfirm) {
            return {code: CODE_CONTINUE, message:`not confirmed, want ${epoch} > ${latestConfirm} confirmed.`}
        }
        if (epoch > maxEpochOfBlock) {
            return {code: CODE_CONTINUE, message: `max epoch in full block table is ${maxEpochOfBlock}, less than ${epoch}`}
        }
        if (reward.length === 0) {
            return {code: CODE_CONTINUE, message:`Reward not ready,  epoch ${epoch} , ${latestConfirm} confirmed.`}
        }
        return FullBlock.sequelize.transaction(async (dbTx)=>{
            const tx = []
            reward.forEach(r=>{
                tx.push(
                    FullBlock.update(
                        {totalReward: r["totalReward"]},
                        {where: {epoch, hash: r["blockHash"]}, limit: 1, transaction: dbTx})
                        .then(([updated]) => updated)
                )
            })
            const updatedArr = await Promise.all(tx)
            // const allModified = updatedArr.reduce((a,b)=>a+b)
        }).then(()=>{
            return {code: CODE_OK, message: 'ok'}
        })
    }
    // fix executed txn count and avg gas price, they are missed or in-correct once.
    public static async fixProps(epochLeft, epochRight) : Promise<number>{
        const sqlCount = `select epoch, count(*) as executedTxnCount, avg(gasPrice) as avgGasPrice, blockPosition as position
            from full_tx where epoch between ? and ?
            group by epoch, blockPosition;`
        const list:any[] = await FullTransaction.sequelize.query(sqlCount, {
            type: QueryTypes.SELECT, replacements: [epochLeft, epochRight]
        })
        if (list.length === 0) {
            return 0
        }

        // const sqlUpdate = `update full_block set executedTxnCount = ?, avgGasPrice = ?
        //     where epoch = ? and position = ?`
        // There is no way to update multiple records by different conditions,
        // so, take the tricky of insert on duplicate key update.
        // fill props for non-null field to match schema
        const dummyDt = new Date()
        list.forEach(r=>{
            r.createdAt = dummyDt; r.minerId=0; r.pivot=false;r.txnCount=0;r.difficulty=0;
        })
        const updated = await FullBlock.bulkCreate(list,{
            updateOnDuplicate:['executedTxnCount', 'avgGasPrice'],
            // benchmark: true, logging: console.log
        });
        return updated.length
    }
    public static async fillPropsBatch(batchSize:number = 100) : Promise<number> {
        let prePos = await KV.getNumber(KEY_FILL_BLOCK_PROPS_EPOCH)
        if (isNaN(prePos)) {
            prePos = -1
        }
        const left = prePos + 1
        const right = prePos + batchSize
        let updated = 0
        return this.fixProps(left, right).then(updated0=> {
            updated = updated0
            return KV.upsert({key: KEY_FILL_BLOCK_PROPS_EPOCH, value: right.toString()}, {})
        }).then(()=>{
            process.stdout.write(`\r${new Date().toISOString()} fillPropsAfterConfirmedByConfig, epoch [${left}, ${right}] updated ${updated}`)
            return updated
        }).catch(err=>{
            console.log(`${new Date().toISOString()} fillPropsAfterConfirmedByConfig, error:`, err)
            return 0
        })
    }
}
/*
SELECT TABLE_NAME,PARTITION_NAME,PARTITION_METHOD,PARTITION_EXPRESSION,PARTITION_DESCRIPTION,TABLE_ROWS,CREATE_TIME,UPDATE_TIME
       FROM INFORMATION_SCHEMA.PARTITIONS
       WHERE PARTITION_NAME is not null;

ALTER TABLE full_block DROP PARTITION pm;
alter table full_block add partition (partition p4 values less than (40000000));
alter table full_block add partition (partition p5 values less than (50000000));

ALTER TABLE full_tx DROP PARTITION pm;
alter table full_tx add partition (partition p4 values less than (40000000));
alter table full_tx add partition (partition p5 values less than (50000000));

alter table full_block add column `executedTxnCount` bigint unsigned null  default null;

https://dev.mysql.com/doc/refman/5.7/en/partitioning-limitations-locking.html
ALTER TABLE ... TRUNCATE PARTITION prunes locks; only the partitions to be emptied are locked.

select count(*) from block_row_mark;
select * from block_row_mark order by id desc limit 10;
select * from tx_row_mark order by id desc limit 10;
select count(*) from full_block where epoch > ;
select * from daily_token order by transferCount desc limit 10;
 */
