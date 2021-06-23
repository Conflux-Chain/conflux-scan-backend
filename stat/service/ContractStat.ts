import {Op, Sequelize} from 'sequelize'
import {DailyContractStat} from "../model/DailyContractStat";
import {calBeginEndTime, getNextDelay, getYesterday} from "./tool/DateTool";
import {AddressCfxTransfer} from "../model/CfxTransfer";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {Erc777Transfer} from "../model/Erc777Transfer";
import {Contract} from "../model/Contract";
import {AddressTransactionIndex} from "../model/FullBlock";

const lodash = require('lodash');
const CONST = require('./common/constant');

export class ContractStat{
    private sequelize: Sequelize;

    constructor(sequelize: Sequelize) {
        this.sequelize = sequelize;
    }

    private async statDaily(day: Date): Promise<any>{
        const contractList = await Contract.findAll({attributes: ['hex40id'], raw: true})
        const hex40IdList = contractList?.map( item => item.hex40id) || [];
        for(const hex40id of hex40IdList){
            const stat = await this.statDailyByAddress(hex40id, day);
            const contractStatDb = await DailyContractStat.findOne({where: {hex40id}});
            if(contractStatDb){
                const updateInfo = lodash.defaults({}, stat, {updatedAt: new Date()});
                const statUpdate = lodash.assign(contractStatDb, updateInfo);
                await DailyContractStat.update(statUpdate, {where: {id: contractStatDb.id}});
            } else{
                let statNew = lodash.assign(new DailyContractStat(), stat);
                await DailyContractStat.add(statNew);
            }
            console.log(`daily_contract_stat record:${JSON.stringify(stat)}`);
        }
        return Promise.resolve(1);
    }

    private async statHistory(startDay?: Date, endDay?: Date){
        const start = startDay || new Date('2020/10/29');
        const end = endDay || getYesterday(new Date());
        do{
            await this.statDaily(start);
            start.setDate(start.getDate() + 1)
        } while(start.getTime() <= end.getTime());
    }

    // 16:10:00 UTC
    public async schedule(countHistory: boolean) {
        const that = this;
        async function repeat() {
            const now = new Date();
            await that.statDaily(getYesterday(now)).catch(err=>{
                console.log(`daily_contract_stat fail: `, err);
            });
            const delay = getNextDelay(now, 1, 10);
            console.log(`schedule daily_contract_stat service in delay ${delay/1000}s.`);
            setTimeout(repeat, delay);
        }
        if(countHistory){
            await this.statHistory();
        }
        repeat().then();
    }

    private async statDailyByAddress(addressId, statDay){
        const {beginTime, endTime} = calBeginEndTime(statDay);
        const txCount = await AddressTransactionIndex.count({
            where: {[Op.and]:[{addressId}, {createdAt: {[Op.gte]:beginTime}}, {createdAt: {[Op.lt]:endTime}}]}});
        const cfxTransferCount = await AddressCfxTransfer.count({
            where: {[Op.and]:[{addressId}, {createdAt: {[Op.gte]:beginTime}}, {createdAt: {[Op.lt]:endTime}}]}});
        const tokenTransfer = await this.getTokenTransferStat(addressId, beginTime, endTime);

        return {hex40id: addressId, statTime: beginTime, tx: txCount, cfxTransfer: cfxTransferCount,
            tokenType: tokenTransfer.type, tokenTransfer: tokenTransfer.count};
    }

    private async getTokenTransferStat(addressId, beginTime, endTime) {
        const [erc20Record, erc721Record, erc777Record, erc1155Record] = await Promise.all([
            Erc20Transfer.count({ where: { contractId: addressId }}),
            Erc721Transfer.count({ where: { contractId: addressId }}),
            Erc777Transfer.count({ where: { contractId: addressId }}),
            Erc1155Transfer.count({ where: { contractId: addressId }}),
        ]);
        let type;
        if(erc20Record) type = CONST.TRANSFER_TYPE.ERC20;
        if(erc721Record) type = CONST.TRANSFER_TYPE.ERC721;
        if(erc777Record) type = CONST.TRANSFER_TYPE.ERC777;
        if(erc1155Record) type = CONST.TRANSFER_TYPE.ERC1155;

        const model = ContractStat.getTokenTransferModel(type);
        const count = await model?.count({
            where: {[Op.and]:[{addressId}, {createdAt: {[Op.gte]:beginTime}}, {createdAt: {[Op.lt]:endTime}}]}});

        return {type, count};
    }

    private static getTokenTransferModel(transferType:string) {
        if(transferType === undefined) {
            return undefined;
        }
        let model
        switch(transferType) {
            case CONST.TRANSFER_TYPE.ERC20: model = Erc20Transfer; break;
            case CONST.TRANSFER_TYPE.ERC721: model = Erc721Transfer; break;
            case CONST.TRANSFER_TYPE.ERC777: model = Erc777Transfer; break;
            case CONST.TRANSFER_TYPE.ERC1155: model = Erc1155Transfer; break;
            default:
                return undefined;
        }
        return model;
    }
}
