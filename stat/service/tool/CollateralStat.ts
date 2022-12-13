import {loadConfig} from "../../config/StatConfig";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {NftMint, Token} from "../../model/Token";
import {Op} from "sequelize";
import {Epoch} from "../../model/Epoch";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {sleep} from "./ProcessTool";
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

if (require.main === module) {
    const args = process.argv.slice(2)
    StatApp.networkId = Number(args[0]);
    run().then();
}
