import {loadConfig} from "../../config/StatConfig";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {NftMint, Token} from "../../model/Token";
import {Op, QueryTypes} from "sequelize";
import {Epoch} from "../../model/Epoch";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {sleep} from "./ProcessTool";
import {DailyNFTStat} from "../../model/DailyNFTStat";
import {fmtDtUTC} from "../../model/Utils";
import {DailyNFTHolder} from "../../model/DailyNFTHolder";
const fs = require('fs');

let cfx:Conflux;
let traceCache = {};

async function init() {
    const config = loadConfig('Prod');
    config.conflux.url = 'http://main.confluxrpc.com/';

    cfx = new Conflux(config.conflux);
    await cfx.updateNetworkId();
    patchHttpProvider(cfx, config.conflux);

    let seq = createDB(config.databaseRW);
    await seq.sync({});
    await initModel(seq);
}

async function run() {
    const result = [];
    await init();

    const contractArray =  await Token.findAll({
        attributes: ['base32', 'hex40id'],
        where: {type: {[Op.in]: ['ERC721', 'ERC1155']}}
    });

    const start = '2020-10-01 00:00:00';
    const veryStatTime = new Date(start);
    let statTime = new Date(start);
    do{
        const preStatTime =new Date(statTime);
        statTime.setMonth(statTime.getMonth() + 1);
        if(statTime > new Date()){
            console.log(`result ${JSON.stringify(result)}`);
            break;
        }

        const epoch = await Epoch.findOne({
            where: {timestamp: {[Op.gte]: statTime}},
            order: [['epoch', 'ASC']],
        });
        const epochNumber = epoch.epoch;
        console.log(`statTime ${statTime} epochNumber ${epochNumber}`);

        let contractTotal = 0;
        let nftTotal = 0;
        let collateralTotal = BigInt(0);
        let counter = 0;
        for(const c of contractArray) {
            const {base32, hex40id} = c;
            let createEpochNumber = traceCache[hex40id];
            if(createEpochNumber === undefined){
                const traceCreate = await TraceCreateContract.findOne({
                    where: {to: hex40id},
                    attributes: ['epochNumber'],
                    raw: true
                });
                createEpochNumber = traceCreate.epochNumber;
                traceCache[hex40id] = createEpochNumber;
            }
            if(createEpochNumber > epochNumber) {
                continue;
            }

            const account = await cfx.getAccount(base32, epochNumber);
            const collateralForStorage = account.collateralForStorage;
            collateralTotal = collateralTotal + collateralForStorage;
            contractTotal =  contractTotal + 1;
            const mintNft = await NftMint.count({where: {
                    [Op.and]: [
                        {contractId: hex40id},
                        {createdAt: { [Op.gte]: preStatTime}},
                        {createdAt: { [Op.lt]: statTime}}
                    ]
                }
            });
            nftTotal = nftTotal + mintNft;
            if((++counter) % 1000 === 0) {
                await sleep(1_000);
                console.log(`statTime ${statTime} epochNumber ${epochNumber} base32 ${base32} collateralForStorage ${collateralForStorage}`)
            }
        }

        const nftOverall = await NftMint.count({where: {
                [Op.and]: [
                    {createdAt: { [Op.gte]: veryStatTime}},
                    {createdAt: { [Op.lt]: statTime}}
                ]
            }
        });
        const stat = {
            statTime: statTime.toISOString().substr(0,10),
            nftContract: contractTotal,
            nft: nftOverall,
            increaseNft: nftTotal,
            collateralStorage: collateralTotal / BigInt(10**18)
        };
        console.log(`stat ${JSON.stringify(stat)}`);
        result.push(stat);
    } while(true);

    for (let i = 0; i < result.length; i ++) {
        const preStat = i > 0 ? result[i-1] : {nftContract: 0, collateralStorage: BigInt(0)};
        result[i].increaseContract =  result[i].nftContract - preStat.nftContract;
        result[i].increaseStorage =  result[i].collateralStorage - preStat.collateralStorage;
    }

    toCSV(result);
}

function toCSV(collateralArray){
    let content = '\ufeffstatTime,nftContract,increaseContract,nft,increaseNft,storageCollateral(CFX),increaseCollateral(CFX)\n';
    collateralArray.forEach(item => {
        content += `${item.statTime},${item.nftContract},${item.increaseContract},${item.nft},${item.increaseNft},${item.collateralStorage},${item.increaseStorage}\n`;
    });
    fs.writeFile('./collateralStat.csv', content, (e) => console.error(`toCSV`, e));
    console.log(`done!`);
}

async function statNFTByMonthly() {
    await init();
    const sql1 = "select * from daily_nft_stat where statType = '1d' and date_format(statTime,'%e') = 1 order by id";
    const monArray: DailyNFTStat[] = await DailyNFTStat.sequelize.query(sql1,{type: QueryTypes.SELECT, raw: true});

    const recordArray=[];
    for (const mon of monArray) {
        const {statTime} = mon;
        const rangeEnd = new Date(statTime);
        const rangeStart = new Date(statTime);
        rangeStart.setMonth(rangeStart.getMonth() - 1);

        const sql2 = "select sum(nftAsset) as nftAsset, sum(nftContract) as nftContract, sum(nftTransfer) as nftTransfer from daily_nft_stat where statTime >= ? and statTime < ? and statType = '1h'";
        const countStatArray: DailyNFTStat[] = await DailyNFTStat.sequelize.query(sql2,{type: QueryTypes.SELECT, raw: true, replacements: [fmtDtUTC(rangeStart), fmtDtUTC(rangeEnd)],});
        console.log(`${rangeStart} countStat ${JSON.stringify(countStatArray[0])}`)

        const sql3 = "select * from daily_nft_stat where statTime >= ? and statTime < ? and statType = '1h' order by statTime desc limit 1";
        const totalStatArray: DailyNFTStat[] = await DailyNFTStat.sequelize.query(sql3,{type: QueryTypes.SELECT, raw: true, replacements: [fmtDtUTC(rangeStart), fmtDtUTC(rangeEnd)],});
        console.log(`${rangeStart} totalStat ${JSON.stringify(totalStatArray[0])}`)

        const record = {
            statTime: rangeStart,
            statType: '1M',
            nftAsset: countStatArray[0].nftAsset,
            nftContract: countStatArray[0].nftContract,
            nftTransfer: countStatArray[0].nftTransfer,
            nftAssetTotal: totalStatArray[0].nftAssetTotal,
            nftContractTotal: totalStatArray[0].nftContractTotal,
            nftTransferTotal: totalStatArray[0].nftTransferTotal,
        };
        recordArray.push(record);
    }

    await DailyNFTStat.bulkCreate(recordArray);
}

async function statNFTHolderByMonthly() {
    await init();
    const sql1 = "select * from daily_nft_holder where statType = '1d' and date_format(statTime,'%e') = 1 order by id";
    const monArray: DailyNFTHolder[] = await DailyNFTHolder.sequelize.query(sql1,{type: QueryTypes.SELECT, raw: true});

    const recordArray=[];
    for (const mon of monArray) {
        const {statTime} = mon;
        const rangeStart = new Date(statTime);
        rangeStart.setHours(rangeStart.getHours() - 1);

        const sql3 = "select * from daily_nft_holder where statTime = ? and statType = '1h' order by statTime desc limit 1";
        const totalStatArray: DailyNFTHolder[] = await DailyNFTStat.sequelize.query(sql3,{type: QueryTypes.SELECT, raw: true, replacements: [fmtDtUTC(rangeStart)],});
        // console.log(`${rangeStart} totalStat ${JSON.stringify(totalStatArray[0])}`)

        const statTimeByMonthly = new Date(rangeStart);
        statTimeByMonthly.setDate(1);
        statTimeByMonthly.setHours(0,0,0,0);
        const record = {
            statTime: statTimeByMonthly,
            statType: '1M',
            holderCount721: totalStatArray[0].holderCount721,
            holderCount1155: totalStatArray[0].holderCount1155,
            holderCount: totalStatArray[0].holderCount,
        };

        console.log(`record ${JSON.stringify(record)}`)
        recordArray.push(record);
    }

    await DailyNFTHolder.bulkCreate(recordArray);
}

if (require.main === module) {
    const args = process.argv.slice(2)
    StatApp.networkId = Number(args[0]);
    // run().then();
    statNFTByMonthly().then();
}
