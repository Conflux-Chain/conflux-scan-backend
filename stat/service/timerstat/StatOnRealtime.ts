import {KEY_GAS_PRICE_TRACKER, KEY_GAS_USED_PER_SECOND, KEY_TOKEN_TRANSFER_PER_SECOND, KV} from "../../model/KV"
import {EpochHashTokenTransfer} from "../../TokenTransferSync";
import {Op, QueryTypes} from "sequelize";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {StatApp} from "../../StatApp";
import {CONST} from "../common/constant";

const lodash = require('lodash')

export class StatOnRealtime {
    private STAT_EPOCHS_AGAINST_LATEST_STATE = 60
    private GAS_USED_COUNTER: any = {}
    private GAS_PRICE_COUNTER: any = {}
    private CIP1559_ENABLED: boolean = false

    constructor() {}

    public async schedule() {
        const that = this

        async function repeat() {
            await that.statTokenTransferPerSecond().catch(err=>{
                console.log(`stat token_transfer_per_second fail: `, err)
            })
            await that.statGasUsedPerSecond().catch(err=>{
                console.log(`stat gas_used_per_second fail: `, err)
            })
            await that.statGasPriceTracker().catch(err=>{
                console.log(`stat gas_price_tracker fail: `, err)
            })
            setTimeout(repeat, 1000)
        }

        repeat().then()
        console.log(`schedule stat_on_realtime service in 1s interval`)
    }

    /*
    message format:
    1. gas price tracker
    {
        epoch: 8888,
        timestamp: 123456,
        blockHeight: 222222
        gasPrice: [111, 222], // pre cip-1559
        gasPrice: [{base: 111, priority: 3},{base: 100, priority: 5},{base: 150, priority: 6}], // post cip-1559
    }
    2. gas used
    {
        epoch: 8888,
        timestamp: 123456,
        gasLimit: "90819949",
    }
    */
    public setGasInfo(epochInfo, action, txArray?, pivotBlock?) {
        const {epoch, blockHeight, timestamp} = epochInfo
        if(action === 'pop'){
            delete this.GAS_PRICE_COUNTER[epoch]
            delete this.GAS_USED_COUNTER[epoch]
            return
        }

        if(CONST.NETWORKS_CIP1559_ENABLED.includes(StatApp.networkId) && !this.CIP1559_ENABLED) {
            this.CIP1559_ENABLED = pivotBlock.blockNumber >= StatApp.bnCIP1559Enabled
        }

        if(!txArray?.length){
            return
        }

        const gasPrices = new Set()
        let gasLimit = BigInt(0)
        for (const tx of txArray) {
            if(this.CIP1559_ENABLED) {
                const priority = (tx?.receipt?.effectiveGasPrice - pivotBlock?.baseFeePerGas) || 0
                gasPrices.add({
                    base: Number(pivotBlock?.baseFeePerGas || tx?.gasPrice || 0),
                    priority: Number(priority)
                })
            } else{
                gasPrices.add(Number(tx.gasPrice))
            }
            gasLimit = gasLimit + tx.gas
        }

        const msg = {epoch, timestamp, blockHeight};
        this.checkLength(this.GAS_USED_COUNTER, this.STAT_EPOCHS_AGAINST_LATEST_STATE)
        this.GAS_USED_COUNTER[epoch] = lodash.defaults(msg, {gasLimit})

        if(gasPrices.size) {
            this.checkLength(this.GAS_PRICE_COUNTER, this.STAT_EPOCHS_AGAINST_LATEST_STATE)
            this.GAS_PRICE_COUNTER[epoch] = lodash.defaults(msg, {gasPrice: [...gasPrices]})
        }
    }

    public async getGasPriceTracker(){
        const config = await KV.findOne({where: {key: KEY_GAS_PRICE_TRACKER}})
        return config?.value ? JSON.parse(config?.value) : {}
    }

    public async getGasUsedPerSecond(){
        const config = await KV.findOne({where: {key: KEY_GAS_USED_PER_SECOND}})
        return config?.value ? JSON.parse(config?.value) : {tps: 0}
    }

    public async getTokenTransferPerSecond(){
        const config = await KV.findOne({where: {key: KEY_TOKEN_TRANSFER_PER_SECOND}})
        return config?.value ? JSON.parse(config?.value) : {tps: 0}
    }

    private async statGasPriceTracker(){
        const zero = this.CIP1559_ENABLED ? 0 : {base: 0, priority: 0, gasPrice: 0}
        let statArray: any[] = Object.values(this.GAS_PRICE_COUNTER)
        statArray = lodash.orderBy(statArray, 'epoch', 'desc')

        let result
        const len = statArray.length
        if( len === 0 ){
            result = {
                gasPriceInfo: {min: zero, tp50: zero, max: zero},
                gasPriceMarket: {min: zero, tp25: zero, tp50: zero, tp75: zero, max: zero},
                maxEpoch: null,
                minEpoch: null,
                maxTime: null,
                minTime: null
            }
        } else if( len === 1 ){
            const stat = statArray[0]
            const gasPriceArray = stat.gasPrice
            const gasPriceTP = this.getPriceInTopPercentile(gasPriceArray)
            result = {
                gasPriceInfo: {...lodash.pick(gasPriceTP, ['min', 'tp50', 'max'])},
                gasPriceMarket: {...gasPriceTP},
                maxEpoch: stat.epoch,
                minEpoch: stat.epoch,
                maxTime: stat.timestamp,
                minTime: stat.timestamp,
                blockHeight: stat.blockHeight,
            }
        } else {
            const latest: any = statArray.find(stat => stat.gasPrice.find(
                priceDetail => this.CIP1559_ENABLED ? Number(priceDetail.base) > 0 : Number(priceDetail) > 0
            ))
            if(!latest) return
            const oldest: any = statArray[statArray.length - 1]
            const gasPriceSet = new Set()
            statArray.forEach(stat => stat.gasPrice.forEach(priceDetail => gasPriceSet.add(priceDetail)))
            result = {
                gasPriceInfo: {... lodash.pick(this.getPriceInTopPercentile(latest.gasPrice), ['min', 'tp50', 'max'])},
                gasPriceMarket: {... this.getPriceInTopPercentile([...gasPriceSet])},
                maxEpoch: latest.epoch,
                minEpoch: oldest.epoch,
                maxTime: latest.timestamp,
                minTime: oldest.timestamp,
                blockHeight: latest.blockHeight,
            }
        }
        await KV.upsert({value: JSON.stringify(result), key: KEY_GAS_PRICE_TRACKER})
    }

    private async statGasUsedPerSecond(){
        let statArray: any[] = Object.values(this.GAS_USED_COUNTER)
        statArray = lodash.orderBy(statArray, 'epoch', 'desc')

        let result
        const len = statArray.length
        if( len === 0 ){
            result = {
                gasUsedPerSecond: 0,
                maxEpoch: null,
                minEpoch: null,
                maxTime: null,
                minTime: null
            }
        } else if( len === 1 ){
            const statInfo = statArray[0]
            const gasUsedPerSecond = statInfo.gasLimit
            result = {
                gasUsedPerSecond ,
                maxEpoch: statInfo.epoch,
                minEpoch: statInfo.epoch,
                maxTime: statInfo.timestamp,
                minTime: statInfo.timestamp
            }
        } else {
            const latest: any = statArray[0]
            const oldest: any = statArray[statArray.length - 1]
            const timeInterval = (latest.timestamp.getTime() - oldest.timestamp.getTime())/1000
            let gasLimitTotal = BigInt(0)
            statArray.forEach(statInfo => {
                gasLimitTotal = gasLimitTotal + BigInt(statInfo.gasLimit)
            })
            const gasUsedPerSecond = timeInterval === 0 ? BigInt(0) : gasLimitTotal / BigInt(timeInterval)
            result = {
                gasUsedPerSecond ,
                maxEpoch: latest.epoch,
                minEpoch: oldest.epoch,
                maxTime: latest.timestamp,
                minTime: oldest.timestamp
            }
        }
        await KV.upsert({value: JSON.stringify(result), key: KEY_GAS_USED_PER_SECOND})
    }

    private async statTokenTransferPerSecond(){
        const maxEpoch: number = await EpochHashTokenTransfer.max('epoch')
        if(maxEpoch === null) {
            return
        }
        const minEpoch = Math.max(maxEpoch - this.STAT_EPOCHS_AGAINST_LATEST_STATE, 0)

        const sql = `
            select sum(t.cntr) as total from (
                select count(*) as cntr from ${Erc20Transfer.getTableName()} where epoch between :minEpoch and :maxEpoch
                union all
                select count(*) as cntr from ${Erc721Transfer.getTableName()} where epoch between :minEpoch and :maxEpoch
                union all
                select count(*) as cntr from ${Erc1155Transfer.getTableName()} where epoch between :minEpoch and :maxEpoch
            ) t`
        const transferTotal = await Erc20Transfer.sequelize.query(sql, {
            type: QueryTypes.SELECT, replacements: {minEpoch, maxEpoch}}).then(arr => (arr[0]['total']))

        const epochRange = await EpochHashTokenTransfer.findAll({where: {epoch: {[Op.in]: [minEpoch, maxEpoch]}}})
            .then(epochs => lodash.keyBy(epochs, 'epoch'))
        const maxTime = epochRange[maxEpoch]['createdAt']
        const minTime = epochRange[minEpoch]['createdAt']
        const timeInterval = (maxTime.getTime() - minTime.getTime())/1000
        const tps = transferTotal / timeInterval

        const result = {tps, maxEpoch, minEpoch, maxTime, minTime}
        await KV.upsert({value: JSON.stringify(result), key: KEY_TOKEN_TRANSFER_PER_SECOND})
    }

    private checkLength(statObj, epochSpan){
        let keys = Object.keys(statObj)
        if(keys.length < epochSpan) {
            return
        }

        do{
            const min = lodash.min(keys)
            delete statObj[min]
            keys = Object.keys(statObj)
        } while (keys.length >= epochSpan)
    }

    private getPriceInTopPercentile(gasPriceArray) {
        gasPriceArray = gasPriceArray.map(priceDetail => {
            if(this.CIP1559_ENABLED) {
                priceDetail['gasPrice'] = priceDetail.base + priceDetail.priority
                return priceDetail
            } else{
                return priceDetail
            }
        })
        const orderedGasPriceArray = gasPriceArray.sort((a, b) => {
            if(this.CIP1559_ENABLED) {
                return a.gasPrice - b.gasPrice
            } else{
                return a - b
            }
        })
        const p = orderedGasPriceArray[0]
        if(gasPriceArray.length === 1) {
            return { min: p, tp25: p, tp50: p, tp75: p, max: p }
        }

        if(p.gasPrice === 0) {
            orderedGasPriceArray.shift()
        }

        const size = gasPriceArray.length
        const tp25Index = Math.ceil(size * 0.25) -1
        const tp50Index = Math.ceil(size * 0.5) -1
        const tp75Index = Math.ceil(size * 0.75) -1

        const min = orderedGasPriceArray[0]
        const tp25 = orderedGasPriceArray[tp25Index]
        const tp50 = orderedGasPriceArray[tp50Index]
        const tp75 = orderedGasPriceArray[tp75Index]
        const max = orderedGasPriceArray[size - 1]

        return {min, tp25, tp50, tp75, max}
    }
}
