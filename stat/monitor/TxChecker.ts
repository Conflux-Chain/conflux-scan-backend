/**
 check full tx is full.
 1 getReceiptsByEpoch, count executed tx in each block, compare with the value in full block.
 2 fix(insert) missing tx; save tracking information.
 */
import {Transaction} from "js-conflux-sdk/types/rpc"
import {AddressTransactionIndex, FailedTx, FullBlock, FullTransaction, IFullTransaction} from "../model/FullBlock";
import {Conflux, TransactionReceipt, format} from "js-conflux-sdk";
import {Sequelize,Model,DataTypes,fn,col,Op} from "sequelize";
import {makeIdV} from "../model/HexMap";
import {FullBlockService} from "../service/FullBlockService";
import {patchHttpProvider} from "../service/common/utils";
import {init} from "../service/tool/FixDailyTokenStat";

async function loadData(epoch: number) {
    return Promise.all([
        FullBlock.findAll({where: {epoch}, order:[['position','asc']]}),
        cfx.getEpochReceipts(epoch),
    ])
}
async function check(epoch:number) {
    const [blocks, receipts2d] = await loadData(epoch)
    if (blocks.length !== receipts2d.length) {
        console.log(` block count not match , ${blocks.length} != ${receipts2d.length} in receipts`)
        process.exit(0)
    }
    const checkInfo:ICheckBlockInfo[] = []
    for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
        const exeTxCnt = receipts2d[bIdx].filter(tx=>tx.outcomeStatus === 0 || tx.outcomeStatus === 1).length
        const preExeTxCnt = blocks[bIdx].executedTxnCount;
        if (preExeTxCnt < exeTxCnt) {
            checkInfo.push({epoch, blockIdx: bIdx, wrongTxCnt: preExeTxCnt,
            rightTxCnt: exeTxCnt, epochTime: null})
        } else if (preExeTxCnt > exeTxCnt) {
            console.log(` ERR003, exist exeTxCnt ${preExeTxCnt} > ${exeTxCnt} in receipts, epoch ${epoch}`)
            process.exit(0);
        }
    }
    if (checkInfo.length) {
        await fixEpoch(epoch, checkInfo, receipts2d)
        fixed ++
    } else {
        process.stderr.write(`\r\u001b[2K Target epoch ${endEpoch}, remain ${endEpoch - epoch
        }, fixed ${fixed}. It's ok ${epoch} .   \t\t `)
    }
}

async function buildTxFromReceipt(epoch: number,receipts2d: TransactionReceipt[][], checkInfoArr:ICheckBlockInfo[])  {
    const txArr:IFullTransaction[] = []
    const txByAddressArr = []
    const failedTxArr = []
    const pivotBlock = await cfx.getBlockByEpochNumber(epoch, true)
    const epochTime = new Date(pivotBlock.timestamp * 1000)
    const addrIdSet = new Set<number>()
    for (let cIdx = 0; cIdx < checkInfoArr.length; cIdx++) {
        const bIdx = checkInfoArr[cIdx].blockIdx
        const txInBlock = receipts2d[bIdx];
        if (txInBlock.length === 0) {
            continue;
        }
        // block info
        const blockDetail = bIdx === receipts2d.length ? pivotBlock
            : await cfx.getBlockByHash(txInBlock[0].blockHash, true)
        let txPos = -1;
        let sumGasPrice = BigInt(0)
        for (let txIdx = 0; txIdx < txInBlock.length; txIdx++) {
            const t = blockDetail.transactions[txIdx] as Transaction;
            const r = txInBlock[txIdx]
            const {outcomeStatus} = r
            if (outcomeStatus !== 0 && outcomeStatus !== 1) {
                continue
            }
            txPos ++
            const txBean = {
                epoch: r.epochNumber as number, blockPosition: bIdx, txPosition: txPos,
                status: outcomeStatus, hash: r.transactionHash, createdAt: epochTime,

                fromId: await makeIdV(format.hexAddress(r.from)),
                toId: r.to?.length > 40 ? await makeIdV(format.hexAddress(r.to)) : 0,
                nonce: t.nonce, gas: r['gasFee'] as number || 0,// save gasFee., gasPrice: 0, method: '',
                contractCreatedId: r.contractCreated?.length > 40
                    ? await makeIdV(format.hexAddress(r.contractCreated)) : 0,
                dripValue: t.value as number, gasPrice: t.gasPrice,
                method: t.data.substr(0, 10)
            }
            txBean['addressId'] = txBean.fromId
            txArr.push(txBean)
            addrIdSet.add(txBean.fromId)
            const dummyTo = txBean.toId || txBean.contractCreatedId
            if (dummyTo && dummyTo !== txBean.fromId) {
                const clone = {...txBean, addressId: 0}
                clone.addressId = dummyTo
                txByAddressArr.push(clone)
                addrIdSet.add(txBean.toId)
            }
            sumGasPrice += BigInt(t.gasPrice)
            if (txBean.status !== 0) {
                txBean['receipt'] = r;
                failedTxArr.push(FullBlockService.syncFailedTx(epoch, txBean))
            }
        } // tx loop end
        if (sumGasPrice) {
            checkInfoArr[cIdx].avgGasPrice = sumGasPrice / BigInt(txPos+1)
        }
        checkInfoArr[cIdx].epochTime = epochTime;
    }
    return {txArr, txByAddressArr, failedTxArr, pivotBlock, addrIdArr: [...addrIdSet]}
}

async function fixEpoch(epoch: number, checkInfo:ICheckBlockInfo[], receipts2d: TransactionReceipt[][]) {
    // delete all tx; insert new ones; update exeTxCnt in block;
    const {txArr, txByAddressArr, failedTxArr, pivotBlock, addrIdArr} =
        await buildTxFromReceipt(epoch, receipts2d, checkInfo);
    await FullBlock.sequelize.transaction(async ____dbTx=>{
        await Promise.all([
            FullTransaction.destroy({where: {epoch}, transaction: ____dbTx}),
            FailedTx.destroy({where: {epoch}, transaction: ____dbTx}),
            AddressTransactionIndex.destroy({
                where: {addressId: {[Op.in]: addrIdArr, }, epoch}, transaction: ____dbTx,
            })
        ])
        await Promise.all([
            AddressTransactionIndex.bulkCreate(txByAddressArr, {transaction: ____dbTx}),
            CheckBlockInfo.bulkCreate(checkInfo, {transaction: ____dbTx, updateOnDuplicate: ['rightTxCnt']}),
            FullTransaction.bulkCreate(txArr, {transaction: ____dbTx}),
            FailedTx.bulkCreate(failedTxArr, {transaction: ____dbTx}),
            Promise.all(checkInfo.map(info=>{
                return FullBlock.update({
                    executedTxnCount: info.rightTxCnt,
                    avgGasPrice: info.avgGasPrice,
                }, {
                    where: {epoch: info.epoch, position: info.blockIdx},
                    transaction: ____dbTx,
                })
            }))
        ])
    })
    console.log(` fix epoch ${epoch}.`)
}
interface ICheckBlockInfo {
    // block idx = -1 --> it's just a mark for processed epoch.
    epoch: number; blockIdx: number; wrongTxCnt:number; rightTxCnt:number;
    epochTime: Date;
    avgGasPrice?:bigint
}
export class CheckBlockInfo extends Model<ICheckBlockInfo> implements ICheckBlockInfo {
    epoch: number; blockIdx: number; wrongTxCnt:number; rightTxCnt:number;
    epochTime: Date;
    static register(seq:Sequelize) {
        CheckBlockInfo.init({
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            blockIdx: {type: DataTypes.INTEGER, allowNull: false},
            wrongTxCnt: {type: DataTypes.INTEGER, allowNull: false},
            rightTxCnt: {type: DataTypes.INTEGER, allowNull: false},
            epochTime: {type: DataTypes.DATE, allowNull: false},
        },{
            sequelize: seq, tableName: 'check_epoch_info', timestamps: false,
            indexes: [
                {name: 'pk_epoch_blk', fields: ['epoch','blockIdx'], unique: true}
            ]
        })
    }
}
let cfx:Conflux;
let endEpoch = 0
let fixed = 0
let startMS = 0
async function run() {
    const [,,url,epochL, epochR] = process.argv
    cfx = new Conflux({url})
    if (!url.includes('ws')) {
        patchHttpProvider(cfx, {url})
    }
    const st = await cfx.getStatus()
    await init();
    console.log(`----------- network ${st.networkId} -----------`)
    let start = parseInt(epochL)
    const veryStart = start
    const end = endEpoch = parseInt(epochR)
    // [start, end]
    startMS = Date.now()
    let processed = 0
    while (start <= end && start<=st.latestConfirmed) {
        await check(start).catch(err=>{
            console.log(` error005, epoch ${start}.`, err)
            process.exit(9)
        })
        processed ++
        if (processed % 100 === 0) {
            const elapse = Date.now() - startMS
            console.log(`\n processed ${processed}, elapse ${elapse
            }, avg ${(elapse/processed).toPrecision(5)}`)
        }
        start ++;
    }
    console.log(` check done [${veryStart}, ${end}], latestConfirmed ${st.latestConfirmed}`)
    await FullBlock.sequelize.close()
    process.exit(0)
}
run().then()