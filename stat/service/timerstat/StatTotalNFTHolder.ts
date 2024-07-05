import {Op} from 'sequelize'
import {NFTBalance} from "../../model/Balance";
import {IntervalType, TimerStat} from "./TimerStat";
import {DailyNFTHolder} from "../../model/DailyNFTStat";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {makeIdV} from "../../model/HexMap";
import {CONST} from "../common/constant";

const lodash = require('lodash');

export class StatTotalNFTHolder extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.HOUR;
    }

    public bizAlias(): string {
        return `${DailyNFTHolder.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyNFTHolder.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 60);
    }

    /*nft transfer via Erc721Transfer and Erc1155Transfer*/
    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return this.firstEpochViaEpochTask(rangeEnd);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date) {
        const hStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat =
            lodash.assign({...hStat}, {statTime: this.getRangeBegin(rangeEnd, IntervalType.DAY), statType: IntervalType.DAY});
        const mStat =
            lodash.assign({...hStat}, {statTime: this.getRangeBegin(rangeEnd, IntervalType.MONTH), statType: IntervalType.MONTH});
        this.debug && console.log(`debug-5,hStat:${JSON.stringify(hStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [hStat, dStat, mStat];
        await DailyNFTHolder.sequelize.transaction(async (dbTx) => {
            await DailyNFTHolder.destroy({
                where: {statType: dStat.statType, statTime: dStat.statTime}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyNFTHolder.destroy({
                where: {statType: mStat.statType, statTime: mStat.statTime}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyNFTHolder.bulkCreate(statArray, {
                transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]bulkCreate ${msg}`),*/
            });
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    private async statRaw(beginTime: Date, endTime: Date): Promise<DailyNFTHolder> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        // recursive 721/1155 transfer to update nft balance
        await this.updateNFTBalance(beginTime, endTime);

        const [holderCount721, holderCount1155, holderCount] = await Promise.all([
            NFTBalance.count({where: {nft721: {[Op.gt]: 0}}}),
            NFTBalance.count({where: {nft1155: {[Op.gt]: 0}}}),
            NFTBalance.count({where: {total: {[Op.gt]: 0}}}),
        ]);

        return {
            statTime: beginTime, statType: intervalType, holderCount, holderCount721, holderCount1155
        } as DailyNFTHolder;
    }

    private async updateNFTBalance(beginTime: Date, endTime: Date) {
        const {ERC721, ERC1155} = CONST.TRANSFER_TYPE;
        const zeroAddrId = await makeIdV('0'.padStart(40, '0'));

        const[ts721Array, ts1155Array] = await Promise.all([
            Erc721Transfer.findAll({
                where: {[Op.and]: [{createdAt: {[Op.gte]:beginTime}}, {createdAt: {[Op.lt]:endTime}},]},
                order:[['createdAt', 'asc']]
            }),
            Erc1155Transfer.findAll({
                where: {[Op.and]: [{createdAt: {[Op.gte]:beginTime}}, {createdAt: {[Op.lt]:endTime}},]},
                order:[['createdAt', 'asc']]
            }),
        ]);

        const statNFTBalance = (tsArray, updateInfo) => {
            tsArray.forEach(ts => {
                const {fromId, toId} = ts;
                const [val, type] = ts['value'] ? [ts['value'], ERC1155] : [1, ERC721];
                if(fromId !== zeroAddrId) {
                    updateInfo[fromId] = updateInfo[fromId] ? updateInfo[fromId] : {nft721: BigInt(0), nft1155: BigInt(0), total: BigInt(0)};
                    type === ERC721 ? (updateInfo[fromId].nft721 -= BigInt(val)) : (updateInfo[fromId].nft1155 -= BigInt(val));
                    updateInfo[fromId].total -= BigInt(val);
                }
                if(toId !== zeroAddrId) {
                    updateInfo[toId] = updateInfo[toId] ? updateInfo[toId] : {nft721: BigInt(0), nft1155: BigInt(0), total: BigInt(0)};
                    type === ERC721 ? (updateInfo[toId].nft721 += BigInt(val)) : (updateInfo[toId].nft1155 += BigInt(val));
                    updateInfo[toId].total += BigInt(val);
                }
            });
        }
        const updateInfo = {};
        statNFTBalance(ts721Array, updateInfo);
        statNFTBalance(ts1155Array, updateInfo);

        const addressIdArray = Object.keys(updateInfo);
        for(const addressId of addressIdArray) {
            await NFTBalance.sequelize.transaction(async (dbTx) => {
                const balanceDelta = updateInfo[addressId];
                const nftBalance = await NFTBalance.findOne({where: {addressId}, raw: true});
                if(!nftBalance) {
                    await NFTBalance.create(lodash.assign(balanceDelta, {addressId}), {transaction: dbTx});
                    return;
                }

                const newBalance = {
                    nft721: BigInt(nftBalance.nft721) + BigInt(balanceDelta.nft721),
                    nft1155: BigInt(nftBalance.nft1155) + BigInt(balanceDelta.nft1155),
                    total: BigInt(nftBalance.total) + BigInt(balanceDelta.total),
                }
                if(newBalance.nft721 === BigInt(0) && newBalance.nft1155 === BigInt(0) && newBalance.total === BigInt(0)) {
                    await NFTBalance.destroy({where: {addressId}, transaction: dbTx});
                    return;
                }

                await NFTBalance.update(newBalance, {where: {addressId}, transaction: dbTx});
            });
        }
    }
}