import {AddressCfxBill, buildAddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer";
import {Conflux} from "js-conflux-sdk";
import {Hex64Map} from "../../model/HexMap";
import {Op} from "sequelize"
import {init} from "../tool/FixDailyTokenStat";
import {POS_CFX_BILL, Position} from "../../model/KV";

const CODE_REACH_EPOCH_LIMIT = 123
const CODE_STOP = 2013
export class CfxBillService {
    cfx:Conflux
    constructor(cfx:Conflux) {
        this.cfx = cfx
    }

    async getStopAtEpoch() {
        return this.cfx.getEpochNumber("latest_confirmed").then(max=>{
            return max - 1000
        })
    }
    async run() {
        const prePos = await Position.getPosDefault(POS_CFX_BILL, 0)
        let stopAtEpoch = await this.getStopAtEpoch()

        const that = this
        let handlePos = prePos
        async function repeat() {
            handlePos ++
            that.processPos(handlePos).catch(err=>{
                console.log(`cfx bill service fail at epoch ${handlePos} #`, err)
                return CODE_STOP
            }).then((res)=>{
                that.debugProgress(handlePos)
                if (res === CODE_REACH_EPOCH_LIMIT) {
                    that.getStopAtEpoch().then(epoch=>{
                        stopAtEpoch = epoch
                        handlePos --
                        setTimeout(repeat, 5000)
                    });
                    return
                }
                if (res !== CODE_STOP){
                    Position.setPosition(POS_CFX_BILL, handlePos).then(()=>{
                        setTimeout(repeat, 0)
                    })
                }
            })
        }
        repeat().then()
    }

    debugProgress(pos) {
        if (pos % 100 === 0) {
            console.log(`${new Date().toISOString()} current pos ${pos}`)
        }
    }
    async processPos(transferId: number, maxEpoch:number = Infinity) {
        const transfer = await CfxTransfer.findByPk(transferId);
        if (!transfer) {
            console.log(`transfer not found, id ${transferId}`)
            return
        }
        if (transfer.epoch >= maxEpoch) {
            return CODE_REACH_EPOCH_LIMIT
        }
        return this.processTransfer(transfer);
    }
    async processTransfer(transfer:CfxTransfer) {
        // check tx success and in the right epoch
        const txHash = await Hex64Map.findByPk(transfer.txHashId)
        if (!txHash) {
            console.log(`tx hash not found , transfer id ${transfer.id}, epoch ${
                transfer.epoch}, tx hash id ${transfer.txHashId}`)
        }
        const txInfo:any = await this.cfx.getTransactionByHash(txHash.hex).catch(err=>{
            console.log(`getTransactionByHash fail, hash ${txHash.hex}.`, err)
        });
        if (!txInfo) {
            return
        }
        if (txInfo.status !== 0) {
            console.log(`transaction failed, ${txHash.hex}`)
            return
        }
        if (txInfo.epoch !== transfer.epoch) {
            console.log(`transaction epoch ${txInfo.epoch} !== ${transfer.epoch} in transfer, skip.`)
            return
        }
        // find both side previous record
        if (transfer.fromId !== transfer.toId) {
            const [preFrom, preTo] = await Promise.all([
                this.findPreBill(transfer.fromId, transfer.epoch),
                this.findPreBill(transfer.toId, transfer.epoch),
            ])
            const curFrom = this.buildAddressCfxBill(transfer, preFrom, transfer.fromId)
            const curTo = this.buildAddressCfxBill(transfer, preTo, transfer.toId)
            return AddressCfxBill.bulkCreate([curFrom, curTo])
        }
        // if from equals to, then do nothing.
    }
    buildAddressCfxBill(transfer:CfxTransfer, pre:AddressCfxBill, addrId:number) {
        // The pos field is part of the unique key, the value of it is meaningless.
        const ret = buildAddressCfxTransfer(transfer, addrId, transfer.id % 10000000)
        ret.balance = (pre ? pre.balance : 0) + transfer.value
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