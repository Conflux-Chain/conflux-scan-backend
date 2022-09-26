import {Op} from 'sequelize'
import {DailyContractStat} from "../../model/DailyContractStat";
import {FullTransaction} from "../../model/FullBlock";
import {CfxTransfer} from "../../model/CfxTransfer";
import {Epoch} from "../../model/Epoch";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {makeId} from "../../model/HexMap";
import {CONST} from "../common/constant"
import {IntervalType, TimerStat} from "./TimerStat";

export class StatDailyContractAnalysis extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.DAY;
    }

    public bizAlias(): string {
        return `${DailyContractStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyContractStat.findOne({
            order:[["statTime","desc"]],
            limit: 1
        });

        return this.getStatSpanDay(lastStat, 1);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return Epoch.findOne({
            attributes:['epoch'],
            where: {timestamp: {[Op.gte]: rangeEnd}},
            order:[['timestamp', 'asc']],
            limit: 1
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const contractArray = await TraceCreateContract.findAll({attributes: ['to', 'blockTime'], raw: true}) || [];
        await this.addInternalContract(contractArray);

        for (const [index, contract] of contractArray.entries()) {
            const contractStatDb = await DailyContractStat.findOne({where: {hex40id: contract.to, statTime: rangeBegin}});
            if(contractStatDb){
                continue;
            }
            const stat = await this.statDailyByAddress(contract, rangeBegin, rangeEnd);
            if(!stat){
                continue;
            }

            await DailyContractStat.add(stat as DailyContractStat);
            if (index % 1000 == 0) {
                console.log(`[${this.bizAlias()}]record:${JSON.stringify(stat)}`);
            }
        }
    }

    // ------------------------------- biz -----------------------------------
    private async statDailyByAddress(contract, rangeBegin: Date, rangeEnd: Date){
        const addressId = contract.to;
        const blockTime = contract.blockTime;
        if(blockTime >= rangeEnd.getTime() / 1000){
            return undefined;
        }

        const txCount = await FullTransaction.count({
            where: {
                [Op.and]:
                    [
                        {createdAt: {[Op.gte]:rangeBegin}},
                        {createdAt: {[Op.lt]:rangeEnd}},
                        {[Op.or]: [{fromId: addressId}, {toId: addressId}]},
                    ]
            }});
        const cfxTransferCount = await CfxTransfer.count({
            where: {
                [Op.and]:
                    [
                        {createdAt: {[Op.gte]:rangeBegin}},
                        {createdAt: {[Op.lt]:rangeEnd}},
                        {[Op.or]: [{fromId: addressId}, {toId: addressId}]},
                    ]
            }});
        const tokenTransfer = await this.getTokenTransferStat(addressId, rangeBegin, rangeEnd);

        return {hex40id: addressId, statTime: rangeBegin, tx: txCount, cfxTransfer: cfxTransferCount,
            tokenType: tokenTransfer.type, tokenTransfer: tokenTransfer.count};
    }

    private async getTokenTransferStat(contractId, rangeBegin, rangeEnd) {
        const [erc20Record, erc721Record, erc1155Record] = await Promise.all([
            Erc20Transfer.findOne({ where: { contractId }}),
            Erc721Transfer.findOne({ where: { contractId}}),
            Erc1155Transfer.findOne({ where: { contractId }}),
        ]);

        let type;
        let model;
        if(erc20Record) {
            type = CONST.TRANSFER_TYPE.ERC20;
            model = Erc20Transfer;
        } else if(erc721Record) {
            type = CONST.TRANSFER_TYPE.ERC721;
            model = Erc721Transfer;
        } else if(erc1155Record) {
            type = CONST.TRANSFER_TYPE.ERC1155;
            model = Erc1155Transfer;
        }

        const count = await model?.count({
            where: {[Op.and]:[{ contractId }, {createdAt: {[Op.gte]:rangeBegin}}, {createdAt: {[Op.lt]:rangeEnd}}]}});
        return {type, count};
    }

    private async addInternalContract(contractList){
        const internalContractArray = CONST.INTERNAL_CONTRACT;

        for (const hex40 of internalContractArray) {
            const addressId = (await makeId(hex40)).id;
            contractList.push({to: addressId, blockTime: 0});
        }

        return contractList;
    }
}

