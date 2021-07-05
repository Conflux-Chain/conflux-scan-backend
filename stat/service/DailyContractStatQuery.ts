// @ts-ignore
import {format} from "js-conflux-sdk";
import {DailyContractStat} from "../model/DailyContractStat";
import {Hex40Map} from "../model/HexMap";

export class DailyContractStatQuery {

    async listStat(address, skip: number = 0, limit: number = 1000) {
        const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}})
        const hex40id = hex40?.id
        if(hex40id === undefined){
            return {total: 0};
        }

        const page = await DailyContractStat.findAndCountAll({
            attributes: ['statTime', 'tx', 'cfxTransfer', 'tokenTransfer'],
            where: {hex40id}, offset: skip, limit, order:[["statTime", "DESC"]]
        })
        return { total: page?.count || 0, list: page?.rows };;
    }
}
