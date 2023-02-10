import {QueryTypes} from 'sequelize'
import {fmtDtUTC} from "../../model/Utils";
import {IntervalType, TimerStat} from "./TimerStat";
import {DailyNFTStat} from "../../model/DailyNFTStat";
import {NftMint, Token} from "../../model/Token";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";

const BigFixed = require('bigfixed');
const lodash = require('lodash');

export class StatDailyNFT extends TimerStat{

    constructor(app: any) {
        super(app);
        this.baseInterval = IntervalType.HOUR;
    }

    public bizAlias(): string {
        return `${DailyNFTStat.getTableName()}`;
    }

    public async nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}> {
        const lastStat = await DailyNFTStat.findOne({
            where: {statType: this.baseInterval},
            order:[["statTime","desc"]],
            limit: 1
        });
        return this.getStatRangeMin(lastStat, 60);
    }

    /*nft count via NFTMint
    nft contract via TraceCreateContract
    nft transfer via Erc721Transfer and Erc1155Transfer*/
    public async firstEpochAfterRangeEnd(rangeEnd): Promise<number> {
        return this.firstEpochViaEpochTask(rangeEnd);
    }

    public async stat(rangeBegin: Date, rangeEnd: Date){
        const hStat = await this.statRaw(rangeBegin, rangeEnd);
        const dStat = await this.statAnalysis(rangeEnd, IntervalType.HOUR, IntervalType.DAY, hStat);
        const mStat = await this.statAnalysis(rangeEnd, IntervalType.HOUR, IntervalType.MONTH, hStat);
        this.debug && console.log(`debug-5,hStat:${JSON.stringify(hStat)},dStat:${JSON.stringify(dStat)}`);

        const statArray = [hStat, dStat, mStat];
        await DailyNFTStat.sequelize.transaction(async (dbTx) => {
            await DailyNFTStat.destroy({
                where: {statTime: dStat.statTime, statType: dStat.statType}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyNFTStat.destroy({
                where: {statTime: mStat.statTime, statType: mStat.statType}, transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]destroy ${msg}`),*/
            });
            await DailyNFTStat.bulkCreate(statArray, {
                transaction: dbTx,
                /*logging: msg => console.log(`[${this.bizAlias()}]bulkCreate ${msg}`),*/
            });
        });
        console.log(`[${this.bizAlias()}]record:${JSON.stringify(statArray)}`);
    }

    // ------------------------------- biz -----------------------------------
    private async statRaw(beginTime: Date, endTime: Date): Promise<DailyNFTStat> {
        const { intervalType } = this.supportInterval(beginTime, endTime, this.baseInterval);

        const nftAssetSql = `SELECT count(id) AS nftAsset FROM ${NftMint.getTableName()} WHERE createdAt >= ? and 
            createdAt < ?`;
        const nftContractSql = `select count(id) AS nftContract from ${Token.getTableName()} where token.hex40id in (
            select \`to\` from ${TraceCreateContract.getTableName()} where blockTime >= ? and blockTime < ?) 
            and (type = 'ERC721' or type = 'ERC1155')`;
        const ts721sql = `select count(*) ts from ${Erc721Transfer.getTableName()} where createdAt >= ? and createdAt < ?`;
        const ts1155sql = `select count(*) ts from ${Erc1155Transfer.getTableName()} where createdAt >= ? and createdAt < ?`;
        const totalSql = `select sum(nftAsset) as nftAssetTotal, sum(nftContract) as nftContractTotal, 
            sum(nftTransfer) as nftTransferTotal from ${DailyNFTStat.getTableName()} where statTime < ? and statType = '${intervalType}'`;

        const [nftAssetStat, nftContractStat, ts721Stat, ts1155Stat, totalStat] = await Promise.all([
            NftMint.sequelize.query(nftAssetSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            }),
            Token.sequelize.query(nftContractSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [beginTime.getTime() / 1000, endTime.getTime() / 1000],
            }),
            Erc721Transfer.sequelize.query(ts721sql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            }),
            Erc1155Transfer.sequelize.query(ts1155sql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)],
            }),
            DailyNFTStat.sequelize.query(totalSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime)],
            })
        ]);

        const statTime = beginTime;
        const nftAsset = BigFixed(nftAssetStat[0]['nftAsset']);
        const nftContract = BigFixed(nftContractStat[0]['nftContract']);
        const nftTransfer = BigFixed(ts721Stat[0]['ts']).add(BigFixed(ts1155Stat[0]['ts']));
        const nftAssetTotal = BigFixed(totalStat[0]['nftAssetTotal'] || 0).add(nftAsset);
        const nftContractTotal = BigFixed(totalStat[0]['nftContractTotal'] || 0).add(nftContract);
        const nftTransferTotal = BigFixed(totalStat[0]['nftTransferTotal'] || 0).add(nftTransfer);

        return {
            statTime, statType: intervalType,
            nftAsset, nftContract, nftTransfer,
            nftAssetTotal, nftContractTotal, nftTransferTotal,
        } as DailyNFTStat;
    }

    private async statAnalysis(endTime: Date, srcStatType: IntervalType, destStatType: IntervalType,
                                latestStat = undefined): Promise<DailyNFTStat> {
        const beginTime = this.getRangeBegin(endTime, destStatType);

        const statSql = `SELECT statTime,statType,nftAsset,nftContract,nftTransfer FROM ${DailyNFTStat.getTableName()} 
                    WHERE statTime >= ? and statTime < ? and statType = '${srcStatType}'` ;
        const totalSql = `select sum(nftAsset) as nftAssetTotal, sum(nftContract) as nftContractTotal, 
            sum(nftTransfer) as nftTransferTotal from ${DailyNFTStat.getTableName()} where statTime < ? and statType = '${destStatType}'`;

        const [statList, totalStat] = await Promise.all([
            DailyNFTStat.sequelize.query(statSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime), fmtDtUTC(endTime)]}),
            DailyNFTStat.sequelize.query(totalSql, { type: QueryTypes.SELECT, raw: true,
                replacements: [fmtDtUTC(beginTime)],
            }),
        ]);
        if(latestStat) {
            statList.push(latestStat);
        }

        const statTime = beginTime;
        let nftAsset = BigFixed(0);
        let nftContract = BigFixed(0);
        let nftTransfer = BigFixed(0);
        lodash.forEach(statList, stat => {
            nftAsset = nftAsset.add(BigFixed(stat['nftAsset']));
            nftContract = nftContract.add(BigFixed(stat['nftContract']));
            nftTransfer = nftTransfer.add(BigFixed(stat['nftTransfer']));
        });
        const nftAssetTotal = BigFixed(totalStat[0]['nftAssetTotal'] || 0).add(nftAsset);
        const nftContractTotal = BigFixed(totalStat[0]['nftContractTotal'] || 0).add(nftContract);
        const nftTransferTotal = BigFixed(totalStat[0]['nftTransferTotal'] || 0).add(nftTransfer);

        return {statTime, statType: destStatType,
            nftAsset, nftContract, nftTransfer,
            nftAssetTotal, nftContractTotal, nftTransferTotal
        } as DailyNFTStat;
    }
}
