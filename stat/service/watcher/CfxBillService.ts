import {AddressCfxBill, buildAddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {Hex64Map, makeId} from "../../model/HexMap";
import {Op} from "sequelize"
import {init} from "../tool/FixDailyTokenStat";
import {POS_CFX_BILL, Position} from "../../model/KV";
import {Trace} from "../../model/Trace";
import {TransactionDB} from "../../model/Transaction";

const CODE_REACH_EPOCH_LIMIT = 123
const CODE_STOP = 2013
export class CfxBillService {
    cfx:Conflux
    prePos:number = 0
    constructor(cfx:Conflux) {
        this.cfx = cfx
    }

    async getStopAtEpoch() {
        return this.cfx.getEpochNumber("latest_confirmed").then(max=>{
            return max - 1000
        })
    }

    async setupEpoch0() {
        async function make(hex:string, ban, pos) {
            const idBean = await makeId(hex)
            return AddressCfxBill.create({
                addressId: idBean.id,
                fromId: 0, toId: idBean.id,
                balance: ban * 1e+18,
                createdAt: undefined,
                epoch: 0,
                tracePos: pos,
                txHashId: 0,
                value: ban * 1e+18,
            })
        }
        // cfx:acb59fk6vryh8dj5vyvehj9apzhpd72rdpwsc651kz four year
        await make('0x83bf953c8b687f0d1b8d2243a3e0654ec1f70d1b', 42_0000_0000, 0)
        // cfx:ach9eg1rk28060m3kpw44np1znvn6p9ffjkk6651nb two year
        await make('0x8ff21aed4e3d6e59594b25ad2d97aae2be33e52a', 8_0000_0000, 1)
    }
    async run() {
        this.prePos = await Position.getPosDefault(POS_CFX_BILL, 0)
        if (this.prePos === 0) {
            await this.setupEpoch0()
        }
        let stopAtEpoch = await this.getStopAtEpoch();

        const that = this
        async function repeat() {
            return that.processPos(that.prePos+1, stopAtEpoch).catch(err=>{
                console.log(`cfx bill service fail at epoch ${that.prePos+1} #`, err)
                return CODE_STOP
            }).then((res)=>{
                that.debugProgress(that.prePos+1, stopAtEpoch)
                if (res === CODE_REACH_EPOCH_LIMIT) {
                    return that.getStopAtEpoch().then(epoch=>{
                        that.debugProgress(that.prePos+1, stopAtEpoch)
                        stopAtEpoch = epoch
                        setTimeout(repeat, 5000)
                    });
                }
                if (res !== CODE_STOP){
                    // console.log(`save pos ${that.prePos}`)
                    return Position.setPosition(POS_CFX_BILL, that.prePos).then(()=>{
                        setTimeout(repeat, 0)
                    })
                } else {
                    console.log(`stop.`)
                }
            })
        }
        repeat().then()
    }

    debugProgress(pos, stopAtEpoch) {
        if (pos % 100 === 0) {
            console.log(`${new Date().toISOString()} current pos ${pos}, target ${stopAtEpoch}`)
        }
    }
    logCnt = 100
    checkLog() {
        if (this.logCnt <= 0) {
            return false
        }
        this.logCnt --
        return true;
    }
    verbose = false
    async fixHashId(epoch, transferList:CfxTransfer[]) : Promise<number> {
        let transferIdx = 0
        this.checkLog() && console.log(`\n debug it, epoch ${epoch}:`)
        const hashes = await this.cfx.getBlocksByEpochNumber(epoch)
        for (const hash of hashes) {
            const [traces, blockDetail] = await Promise.all([
                this.cfx.traceBlock(hash),
                this.cfx.getBlockByHash(hash, true),
            ])
            this.checkLog() && console.log(`------ block ${hash} traces: ${traces['transactionTraces'].length}`)
            let idx = 0
            for (const obj of traces['transactionTraces']) {
                const rpcTx = blockDetail['transactions'][idx++]
                if (obj.traces.length === 0) {
                    continue
                }
                if (rpcTx.status === 0 || rpcTx.status === null || rpcTx.status === undefined) {
                    // ok or unknown
                } else {
                    // failed
                    this.checkLog() && console.log(`skip failed tx ${rpcTx.hash}, status ${rpcTx.status}`);
                    continue;
                }
                let printTx = true
                for (const t of obj.traces) {
                    if (t.action.value > 0) {
                        const transfer = transferList[transferIdx++];
                        if (transfer.txHashId > 0 && !this.verbose) {
                            continue
                        }
                        if (printTx) {
                            printTx = false;
                            this.checkLog() && console.log(`  -- tx ${rpcTx.hash}`);
                        }
                        const fromHex = format.hexAddress(t.action.from)
                        const toHex =  format.hexAddress(t.action.to)
                        const [fromId,toId] = await Promise.all([
                            makeId(fromHex).then(res=>res.id),
                            makeId(toHex).then(res=>res.id),
                        ])
                        const match = fromId === transfer.fromId
                            && toId === transfer.toId && Number(t.action.value) === Number(transfer.value)
                        this.checkLog() && console.log(`trace, ${fromHex} ${fromId}->${toId} ${toHex} , value ${t.action.value} , match ${match}`)
                        if (transfer.txHashId > 0) {
                        } else if (match) {
                            const txHashId = (await makeId(rpcTx.hash)).id;
                            transfer.set({txHashId})
                        } else {
                            console.log(`  want ${JSON.stringify(transfer)}`)
                        }
                    }
                }
            }
        }
        const allFixed = transferList
            .filter(t=>t.changed() || t.txHashId > 0)
                .length === transferList.length
        if (!allFixed) {
            console.log(`fix fail.`)
            return CODE_STOP
        }
        for (const t of transferList) {
            if (t.changed()) {
                await t.save();
            }
        }
        return 0
    }
    async processPos(epoch: number, maxEpoch:number) {
        const nextEpoch = await CfxTransfer.min('epoch',
            {where: {epoch: {[Op.gte]: epoch}}})

        if (nextEpoch >= maxEpoch) {
            console.log(`reach max ${nextEpoch} >= ${maxEpoch}`)
            return CODE_REACH_EPOCH_LIMIT
        }
        let transferList = await CfxTransfer.findAll({
            where: {epoch: nextEpoch},
            order: [['id','asc']]
        })
        const needFixCnt = transferList.filter(t=>t.txHashId === 0).length
        if (needFixCnt > 0) {
            await this.fixHashId(nextEpoch, transferList)
        }
        let recordPos = 0
        for (const transfer of transferList) {
            const ret = await this.processTransfer(transfer, recordPos)
            if (ret === CODE_STOP) {
                await AddressCfxBill.destroy({
                    where: {epoch: nextEpoch}
                })
                return ret
            }
            recordPos += 10
        }
        this.prePos = Number(nextEpoch)
    }
    async processTransfer(transfer:CfxTransfer, recordPos:number) {
        // check tx success and in the right epoch
        const txHashBean = await Hex64Map.findByPk(transfer.txHashId)
        if (!txHashBean) {
            console.log(`tx hash not found , ${JSON.stringify(transfer)}`)
            return CODE_STOP
        }
        const txHash = '0x'+txHashBean.hex;
        const txInfo:any = await this.cfx.getTransactionReceipt(txHash).catch(err=>{
            console.log(`getTransactionByHash fail, hash ${txHash}.`, err)
        });
        if (!txInfo) {
            return CODE_STOP
        }
        if (txInfo.outcomeStatus !== 0) {
            console.log(`transaction failed, ${txHash}, ${JSON.stringify(transfer)}`)
            return 0
        }
        if (txInfo.epochNumber !== transfer.epoch) {
            console.log(`transaction epoch ${txInfo.epochNumber} !== ${transfer.epoch} in transfer with id ${transfer.id}, tx ${txHash
            }  skip.`)
            return CODE_STOP
        }
        // find both side previous record
        if (transfer.fromId !== transfer.toId) {
            const [preFrom, preTo] = await Promise.all([
                this.findPreBill(transfer.fromId, transfer.epoch),
                this.findPreBill(transfer.toId, transfer.epoch),
            ])
            const curFrom = this.buildAddressCfxBill(transfer, preFrom, transfer.fromId, recordPos)
            const curTo = this.buildAddressCfxBill(transfer, preTo, transfer.toId, recordPos+1)
            return AddressCfxBill.bulkCreate([curFrom, curTo])
        }
        // if from equals to, then do nothing.
    }
    buildAddressCfxBill(transfer:CfxTransfer, pre:AddressCfxBill, addrId:number, recordPos) {
        // The pos field is part of the unique key, the value of it is meaningless.
        const ret = buildAddressCfxTransfer(transfer, addrId, recordPos)
        ret.balance = Number((pre ? pre.balance : 0) )
            + Number(( transfer.fromId === addrId ? -transfer.value: transfer.value))
        return ret;
    }
    async findPreBill(addressId:number, epoch:number) {
        return AddressCfxBill.findOne({where:{
                epoch: {[Op.lt]:epoch},
                addressId},
            order:[['epoch','desc']], limit: 1,
        })
    }
}
/*
delete from address_cfx_bill where epoch > (select pos from Positions where tag='POS_CFX_BILL');
select *,balance/1e+18 from address_cfx_bill where epoch = (select pos from Positions where tag='POS_CFX_BILL');
select * from cfx_transfer where epoch=1;
 */
//
if (require.main === module) {
    init().then(cfg=>{
        const cfx = new Conflux(cfg.conflux)
        const svc = new CfxBillService(cfx)
        const args = process.argv.slice(2)
        svc.verbose = args[0] === 'verbose'
        return svc.run()
    })
}