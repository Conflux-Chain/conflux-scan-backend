import {AddressCfxBill, buildAddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {Conflux} from "js-conflux-sdk";
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
            that.processPos(that.prePos+1, stopAtEpoch).catch(err=>{
                console.log(`cfx bill service fail at epoch ${that.prePos+1} #`, err)
                return CODE_STOP
            }).then((res)=>{
                that.debugProgress(that.prePos+1, stopAtEpoch)
                if (res === CODE_REACH_EPOCH_LIMIT) {
                    that.getStopAtEpoch().then(epoch=>{
                        stopAtEpoch = epoch
                        setTimeout(repeat, 5000)
                    });
                    return
                }
                if (res !== CODE_STOP){
                    // console.log(`save pos ${that.prePos}`)
                    Position.setPosition(POS_CFX_BILL, that.prePos).then(()=>{
                        setTimeout(repeat, 0)
                    })
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
    async fixHashId(transfer:CfxTransfer) : Promise<number> {
        const trace = await Trace.findOne({
            where: {from: transfer.fromId, to:transfer.toId, blockTime:transfer.createdAt,
            value: transfer.value}
        })
        if (!trace) {
            console.log(`trace not found: ${JSON.stringify(transfer)}`)
            return
        }
        const tx = await TransactionDB.findByPk(trace.txId)
        if (!tx) {
            console.log(`tx not found, trace id ${trace.id}, transfer ${JSON.stringify(transfer)}`)
            return CODE_STOP
        }
        const txHashId = await makeId(tx.hash)
        const [upCnt] = await CfxTransfer.update({
            txHashId
        }, {where:{id: transfer.id, txHashId: 0}, limit: 1})
        if (upCnt) {
            console.log(`fix transfer tx hash id, transfer id ${transfer.id} epoch ${transfer.epoch}`)
            return 0
        }
        console.log(`fix transfer tx hash id fail, transfer ${JSON.stringify(transfer)
        }, \n trace ${JSON.stringify(trace)} tx hash ${tx.hash}`)
        return CODE_STOP
    }
    async processPos(epoch: number, maxEpoch:number) {
        const nextEpoch = await CfxTransfer.min('epoch',
            {where: {epoch: {[Op.gte]: epoch}}})

        if (nextEpoch >= maxEpoch) {
            return CODE_REACH_EPOCH_LIMIT
        }
        let transferList = await CfxTransfer.findAll({
            where: {epoch: nextEpoch},
            order: [['id','asc']]
        })
        let recordPos = 0
        for (const transfer of transferList) {
            if (transfer.txHashId === 0) {
                const fixCode = await this.fixHashId(transfer)
                if (fixCode !== 0) {
                    return fixCode
                }
            }
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
            console.log(`tx hash not found , transfer id ${transfer.id}, epoch ${
                transfer.epoch}, tx hash id ${transfer.txHashId}`)

        }
        const txHash = '0x'+txHashBean.hex;
        const txInfo:any = await this.cfx.getTransactionReceipt(txHash).catch(err=>{
            console.log(`getTransactionByHash fail, hash ${txHash}.`, err)
        });
        if (!txInfo) {
            return
        }
        if (txInfo.outcomeStatus !== 0) {
            console.log(`transaction failed, ${txHash}`)
            return CODE_STOP
        }
        if (txInfo.epochNumber !== transfer.epoch) {
            console.log(`transaction epoch ${txInfo.epochNumber} !== ${transfer.epoch} in transfer with id ${transfer.id}, tx ${txHash
            }  skip.`)
            return
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

//
if (require.main === module) {
    init().then(cfg=>{
        const cfx = new Conflux(cfg.conflux)
        const svc = new CfxBillService(cfx)
        return svc.run()
    })
}