import {
    KEY_GAS_PRICE_TRACKER,
    KEY_GAS_USED_PER_SECOND,
    KEY_TOKEN_TRANSFER_PER_SECOND,
    KV
} from "../../model/KV"

const lodash = require('lodash')

export class StatOnRealtime {
    private STAT_EPOCHS_AGAINST_LATEST_STATE = 60
    private TOKEN_TRANSFER_COUNTER: any = {}
    private GAS_USED_COUNTER: any = {}
    private GAS_PRICE_COUNTER: any = {}

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
        gasPrice: [111, 222],
    }
    2. gas used
    {
        epoch: 8888,
        timestamp: 123456,
        gasLimit: "90819949",
    }
    */
    public setGasInfo(epochInfo, action, txArray?) {
        const {epoch, blockHeight, timestamp} = epochInfo
        if(action === 'pop'){
            delete this.GAS_PRICE_COUNTER[epoch]
            delete this.GAS_USED_COUNTER[epoch]
        }

        if(!txArray?.length){
            return
        }

        const gasPrices = new Set()
        let gasLimit = BigInt(0)
        for (const tx of txArray) {
            gasPrices.add(tx.gasPrice)
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

    /*message format:
    token transfer counter
    {
       epoch: 8888,
       timestamp: 123456,
       erc20Cntr: 8888,
       erc712Cntr: 8888,
       erc1155Cntr: 8888,
     }*/
    public setTokenTransferInfo(epochInfo, action, tokenTransferCntr) {
        const {epoch, blockHeight, timestamp} = epochInfo
        if(action === 'pop'){
            delete this.TOKEN_TRANSFER_COUNTER[epoch]
        }

        this.checkLength(this.TOKEN_TRANSFER_COUNTER, this.STAT_EPOCHS_AGAINST_LATEST_STATE)
        this.TOKEN_TRANSFER_COUNTER[epoch] = {epoch, timestamp, blockHeight, ...tokenTransferCntr}
    }

    public async getGasPriceTracker(){
        const config = await KV.findOne({where: {key: KEY_GAS_PRICE_TRACKER}})
        return config?.value ? JSON.parse(config?.value) :{
            gasPriceInfo: {min: 0, tp50: 0, max: 0},
            gasPriceMarket: {min: 0, tp25: 0, tp50: 0, tp75: 0, max: 0},
        }
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
        let statArray: any[] = Object.values(this.GAS_PRICE_COUNTER)
        statArray = lodash.orderBy(statArray, 'epoch', 'desc')

        let result
        const len = statArray.length
        if( len === 0 ){
            result = {
                gasPriceInfo: {min: 0, tp50: 0, max: 0},
                gasPriceMarket: {min: 0, tp25: 0, tp50: 0, tp75: 0, max: 0},
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
            const latest: any = statArray.find(item => {return item.gasPrice.find(price => price !== '0')}) // find first none-zero gas price
            const oldest: any = statArray[statArray.length - 1]
            const gasPriceSet = new Set()
            statArray.forEach(stat => stat.gasPrice.forEach(gasPrice => gasPriceSet.add(gasPrice)))
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
        let statArray: any[] = Object.values(this.TOKEN_TRANSFER_COUNTER)
        statArray = lodash.orderBy(statArray, 'epoch', 'desc')

        let result
        const len = statArray.length
        if( len === 0 ){
            result = {
                tps: 0,
                maxEpoch: null,
                minEpoch: null,
                maxTime: null,
                minTime: null
            }
        } else if( len === 1 ){
            const statInfo = statArray[0]
            const tps = statInfo.erc20Cntr + statInfo.erc721Cntr + statInfo.erc1155Cntr
            result = {
                tps ,
                maxEpoch: statInfo.epoch,
                minEpoch: statInfo.epoch,
                maxTime: statInfo.timestamp,
                minTime: statInfo.timestamp
            }
        } else {
            const latest: any = statArray[0]
            const oldest: any = statArray[statArray.length - 1]
            const timeInterval = (latest.timestamp.getTime() - oldest.timestamp.getTime())/1000
            let transferTotal = 0
            statArray.forEach(statInfo => {
                transferTotal = transferTotal + statInfo.erc20Cntr + statInfo.erc721Cntr + statInfo.erc1155Cntr
            })
            const tps = transferTotal / timeInterval
            result = {
                tps ,
                maxEpoch: latest.epoch,
                minEpoch: oldest.epoch,
                maxTime: latest.timestamp,
                minTime: oldest.timestamp
            }
        }
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
        const gasPriceNumberArray = gasPriceArray.map(gasPrice => Number(gasPrice))
        const orderedGasPriceArray = gasPriceNumberArray.sort((a, b) => a - b)
        const p = orderedGasPriceArray[0]
        if(gasPriceArray.length === 1) {
            return { min: p, tp25: p, tp50: p, tp75: p, max: p }
        }

        if(p === 0) {
            orderedGasPriceArray.shift()
        }

        const size = gasPriceNumberArray.length
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
