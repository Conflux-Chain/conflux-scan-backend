import {Op, QueryTypes} from 'sequelize'
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
import {StatType, TimerStat} from "./TimerStat";
import {ConfigInstance, NoCoreSpace} from "../../config/StatConfig";

export class StatDailyContractAnalysis extends TimerStat{

    constructor(app: any, interval: number = 1000 * 60 * 10) {
        super(app);
        this.baseInterval = StatType.DAY;
        this.schedule(interval).then();
    }

    public bizAlias(): string {
        return `${DailyContractStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyContractStat.findOne({
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeDay(lastStat, 1);
    }

    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return Epoch.findOne({
            attributes:['epoch'],
            where: {timestamp: {[Op.gte]: rangeEnd}},
            order:[['timestamp', 'asc']],
            limit: 1,
        }).then(item => item?.epoch);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const [minEpoch, maxEpoch] = await Promise.all([
            Epoch.findOne({where: {timestamp: {[Op.lt]: rangeBegin}}, order: [['timestamp', 'DESC']]}).then(epoch => {return epoch ? epoch.epoch + 1 : 0}),
            Epoch.findOne({where: {timestamp: {[Op.lt]: rangeEnd}}, order: [['timestamp', 'DESC']]}).then(epoch => {return epoch.epoch}),
        ])

        const [txMap, cfxTransferMap, erc20TransferMap, erc721TransferMap, erc1155TransferMap] = await Promise.all(
            [
                this.statByEpochRange(minEpoch, maxEpoch, FullTransaction),
                this.statByEpochRange(minEpoch, maxEpoch, CfxTransfer),
                this.statByEpochRange(minEpoch, maxEpoch, Erc20Transfer),
                this.statByEpochRange(minEpoch, maxEpoch, Erc721Transfer),
                this.statByEpochRange(minEpoch, maxEpoch, Erc1155Transfer),
            ]
        )

        let activeContract:TraceCreateContract[] = null;
        if (ConfigInstance.onlyStatActiveContract) {
            activeContract = []
            for (const map of [txMap, cfxTransferMap, erc20TransferMap, erc721TransferMap, erc1155TransferMap]) {
                const keys = Object.keys(map);
                for (let i = 0; i < keys.length; i++){
                    const key = keys[i];
                    const contract = await TraceCreateContract.findOne({
                        where: {to: key},
                        attributes: ['to', 'blockTime'], raw: true
                    })
                    activeContract.push(contract)
                }
            }
            console.log(`activeContract:${activeContract.length}`);
        }

        const contractArray = activeContract || await TraceCreateContract.findAll({attributes: ['to', 'blockTime'], raw: true}) || [];
        if (!NoCoreSpace) {
            await this.addInternalContract(contractArray);
        }
        const statInfo = {txMap, cfxTransferMap, erc20TransferMap, erc721TransferMap, erc1155TransferMap}
        for (const [index, contract] of contractArray.entries()) {
            const contractStatDb = await DailyContractStat.findOne({where: {hex40id: contract.to, statTime: rangeBegin}});
            if(contractStatDb){
                continue;
            }

            const stat = await this.statDailyByAddress(contract, rangeBegin, rangeEnd, statInfo);
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
    private async statDailyByAddress(contract, rangeBegin: Date, rangeEnd: Date, statInfo){
        const addressId = contract.to;
        const blockTime = contract.blockTime;
        if(blockTime >= rangeEnd.getTime() / 1000){
            return undefined;
        }

        return {
            hex40id: addressId,
            statTime: rangeBegin,
            tx: statInfo.txMap[addressId] || 0,
            cfxTransfer: statInfo.cfxTransferMap[addressId] || 0,
            tokenTransfer: statInfo.erc20TransferMap[addressId] || statInfo.erc20TransferMap[addressId] || statInfo.erc20TransferMap[addressId] || 0
        };
    }

    private async statByEpochRange(minEpoch, maxEpoch, model) {
        const t1 = TraceCreateContract.getTableName()
        const t2 = model.getTableName()
        const sqlWithFrom = `select tcc.to as addr, count(*) as cntr from ${t1} tcc left join ${t2} tmp on tcc.to = tmp.toId
                        where epoch >= ? and epoch < ? group by tcc.to`
        const sqlWithFromTo = `select t.addr as addr, sum(t.cntr) as cntr from (
                        (select count(*) as cntr, tcc.to as addr from ${t1} tcc left join ${t2} tmp on tcc.to = tmp.toId
                        where epoch >= ? and epoch < ? group by tcc.to) 
                        union all 
                        (select count(*) as cntr, tcc.to as addr from ${t1} tcc left join ${t2} tmp on tcc.to = tmp.fromId
                        where epoch >= ? and epoch < ? group by tcc.to)
                        ) t group by t.addr`

        const isStatTx = model === FullTransaction
        const statArray = await TraceCreateContract.sequelize.query(isStatTx ? sqlWithFrom : sqlWithFromTo, {
            type: QueryTypes.SELECT,
            replacements: isStatTx ? [minEpoch, maxEpoch] : [minEpoch, maxEpoch, minEpoch, maxEpoch],
            raw: true,
        })

        const result = {}
        statArray.forEach(stat => result[stat['addr']] = stat['cntr'])
        return result;
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

