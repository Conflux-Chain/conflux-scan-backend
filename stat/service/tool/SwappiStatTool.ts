import {initCfxSdk} from "../common/utils";
import {FullTransaction} from "../../model/FullBlock";
import {Conflux} from "js-conflux-sdk";
import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {StatApp} from "../../StatApp";
import {AbiInfo} from "../../model/ContractInfo";
import {Op} from "sequelize";
import {PpiLiquidity} from "./PpiLiquidity";

const ADDRESS_SWAPPI = 'net1030:abvnbb3um092w5s2rhu1eep2sg0cknzdaygtpjcjt5';

let type: number;
let cfx:Conflux;
let startEpoch: number;
let methodIdSet: Set<string> = new Set<string>();


async function init() {
    const config = loadConfig('Prod')
    cfx = await initCfxSdk(config.conflux)
    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    await AbiInfo.findAll({where:{fullName:{[Op.like]: '%Liquidity%'}}
    }).then(list=>{
        list.forEach(info => methodIdSet.add(info.hash))
    }).catch(err=>{
        console.log(`build method map fail:`, err)
    })
    console.log(`methodIdSet------${JSON.stringify([...methodIdSet])}`);
}

// startBlock: 40397188
async function listTxWithAddLiquidity(epoch) {
    const hashArray = await FullTransaction.findAll({
        where: {
            epoch: {[Op.gte]: epoch},
            toId: 959,
            method: {[Op.in]: [...methodIdSet]}},
            raw: true,
        }
    ).then(list => list.map(item => item.hash));
    console.log(`hashArray:${hashArray.length}`);
    return hashArray
}

async function run() {
    await init();
    //
    // const [,,csv] = process.argv
    const ppi = new PpiLiquidity(cfx)
    //
    if(type === 1){
        const arr = await listTxWithAddLiquidity(startEpoch);
        for(const hash of arr) {
            await ppi.processTx(hash)
        }
        if (process.argv.includes('csv')) {
            ppi.dumpCsv()
        } else {
            ppi.dumpInfo()
        }
        process.exit(0)
    }
    if(type === 2){
    }
    if(type === 3){
    }
}

const args = process.argv.slice(2)
StatApp.networkId = Number(args[0]);
type = Number(args[1]);
if(type === 1){
    startEpoch = Number(args[2]);
}
if(type === 2){
}

run().then();
