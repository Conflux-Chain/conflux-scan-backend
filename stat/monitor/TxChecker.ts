/**
 check full tx is full.
 1 getReceiptsByEpoch, count executed tx in each block, compare with the value in full block.
 2 fix(insert) missing tx; save tracking information.
 */
import {AddressTransactionIndex, FailedTx, FullBlock, FullTransaction, IFullTransaction} from "../model/FullBlock";
import {Conflux, format} from "js-conflux-sdk";
import {Sequelize,Model,DataTypes,fn,col,Op} from "sequelize";
import {getAddrId, makeIdV} from "../model/HexMap";
import {FullBlockService} from "../service/FullBlockService";
import {patchHttpProvider, removeLongData} from "../service/common/utils";
import {init} from "../service/tool/FixDailyTokenStat";
import {sleep} from "../service/tool/ProcessTool";
import {TransactionReceipt, Transaction} from "js-conflux-sdk/dist/types/rpc/types/formatter";

async function loadData(epoch: number) {
    return Promise.all([
        FullBlock.findAll({where: {epoch}, order:[['position','asc']]}),
        cfx.getEpochReceipts(epoch).then(res=>res as TransactionReceipt[][]),
    ])
}
async function check(epoch:number) {
    const [blocks, receipts2d] = await loadData(epoch)
    if (blocks.length !== receipts2d.length) {
        console.log(` block count not match , ${blocks.length} != ${receipts2d.length} in receipts`)
        process.exit(0)
    }
    const checkInfo:ICheckBlockInfo[] = []
    let needFix = false;
    for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
        const exeTxCnt = receipts2d[bIdx].filter(tx=>tx.outcomeStatus === 0 || tx.outcomeStatus === 1).length
        const preExeTxCnt = blocks[bIdx].executedTxnCount;
        checkInfo.push({epoch, blockIdx: bIdx, wrongTxCnt: preExeTxCnt,
        rightTxCnt: exeTxCnt, epochTime: null, avgGasPrice: BigInt(0)})
        if (preExeTxCnt < exeTxCnt) {
            needFix = true;
        } else if (preExeTxCnt > exeTxCnt) {
            // console.log(` ERR003, exist exeTxCnt ${preExeTxCnt} > ${exeTxCnt} in receipts, epoch ${epoch}`)
            // process.exit(0);
            needFix = true;
        }
    }
    if (needFix) {
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
        checkInfoArr[cIdx].epochTime = epochTime;
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
            txByAddressArr.push(txBean);
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
async function fixEvmPhantomTx() {
    const [,,,cmd, doIt] = process.argv
    if (cmd !== 'fixPhantom') {
        return;
    }
    const zero = await getAddrId('0x'.padEnd(42, '0'));
    console.log(`zero addr id ${zero}`)
    const list = await FullTransaction.findAll({
        limit: 1000, where: {},
        order: [['epoch','asc'],['txPosition','asc']]}) // only 84 for that time
    if (list.length === 1000) {
        console.log(`more records found, ${list.length}, should less than 100.`)
        process.exit(9)
    }
    let fixCnt = 0
    for (let i = 0; i < list.length;) {
        const tx = list[i]
        const [receipts] = await cfx.getEpochReceipts(tx.epoch) as TransactionReceipt[][];
        if (receipts.length === 0) {
            console.log(`should have receipts at epoch ${tx.epoch}`)
            process.exit(8)
        }
        for (let j=0; j<receipts.length; j++) {
            const fixTx = list[i];
            i++;
            if (fixTx.epoch !== receipts[j].epochNumber) {
                console.log(`epoch number not match, tx No ${i-1} db ${fixTx.epoch}/${tx.epoch}, receipt ${receipts[j].epochNumber}`)
                removeLongData(receipts)
                console.log(receipts)
                process.exit(8)
            }
            if (fixTx.hash !== receipts[j].transactionHash) {
                if (doIt) {
                    fixTx.hash = receipts[j].transactionHash
                    await FullTransaction.update({hash: receipts[j].transactionHash}, {
                        where: {epoch: fixTx.epoch, txPosition: fixTx.txPosition}, limit: 1,
                    })
                }
                console.log(`${doIt ? '' : 'want'} fix epoch ${fixTx.epoch} , bad ${fixTx.hash}, good ${receipts[j].transactionHash}`)
                fixCnt ++
            }
        }
    }
    console.log(`fixed count ${fixCnt}, total tx matched in db ${list.length}`)
    await FullTransaction.sequelize.close()
    process.exit(0)
}
let cfx:Conflux;
let endEpoch = 0
let fixed = 0
let startMS = 0
async function run() {
    const [,,url,epochL, epochR] = process.argv
    // @ts-ignore
    cfx = new Conflux({url, clientConfig: {maxReceivedMessageSize: 0x0FFFFFFFF}})
    if (url.includes('ws')) {
        // options.clientConfig.maxReceivedMessageSize=0x800000
    } else {
        patchHttpProvider(cfx, {url})
    }
    let st = await cfx.getStatus()
    await init();
    console.log(`----------- network ${st.networkId} ------ getClientVersion ${(await cfx.getClientVersion())} -----`)
    await fixEvmPhantomTx(); // check command inside.
    let start = parseInt(epochL)
    const veryStart = start
    const end = endEpoch = parseInt(epochR)
    // [start, end]
    startMS = Date.now()
    let processed = 0
    while (true) {
        // check anchor epoch
        while (start > st.latestConfirmed) {
            await sleep(5_000)
            st = await cfx.getStatus()
            console.log(` move latestConfirmed anchor to ${st.latestConfirmed}`)
        }
        // check and fix
        await check(start).catch(err=>{
            console.log(` error005, epoch ${start}.`, err)
            process.exit(9)
        })
        processed ++
        if (processed % 1000 === 0) {
            const elapse = Date.now() - startMS
            console.log(`\n processed ${processed}, elapse ${elapse
            }, avg ${(elapse/processed).toPrecision(5)}, latestConfirmed ${st.latestConfirmed}`)
        }
        start ++;

        if (end === 0){
            // loop forever
        } else if (start > end) {
            break;
        }
    }
    console.log(` check done [${veryStart}, ${end}], latestConfirmed ${st.latestConfirmed}`)
    await FullBlock.sequelize.close()
    process.exit(0)
}
if (require.main === module) {
    run().then()
}
// min 13421844 max 14025121  before fix address tx.