import {initCfxSdk} from "../common/utils";
import {FullTransaction} from "../../model/FullBlock";
import {Conflux} from "js-conflux-sdk";
import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {StatApp} from "../../StatApp";
import {AbiSignature} from "../../model/ContractInfo";
import {Op} from "sequelize";
import {PpiLiquidity} from "./PpiLiquidity";

const ADDRESS_SWAPPI = 'net1030:abvnbb3um092w5s2rhu1eep2sg0cknzdaygtpjcjt5';

let cfx:Conflux;
let startEpoch: number;
let methodIdSet: Set<string> = new Set<string>();


async function init() {
    const config = loadConfig('Prod')
    cfx = await initCfxSdk(config.conflux)
    let seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    await AbiSignature.findAll({where:{signature:{[Op.like]: '%Liquidity%'}}
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
    if (command !== 'list-add-liquidity') {
        console.error('Usage: node stat/service/tool/SwappiStatTool.js <networkId> <command> <startEpoch> [csv]');
        console.error('Commands: list-add-liquidity');
        process.exitCode = 1;
        return;
    }

    await init();
    const ppi = new PpiLiquidity(cfx)
    if (command === 'list-add-liquidity') {
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
}

// node stat/service/tool/SwappiStatTool.js 1030 list-add-liquidity 40397188 [csv]
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0]);
const command = args[1];
if (command === 'list-add-liquidity') {
    startEpoch = Number(args[2]);
}

run().then();
