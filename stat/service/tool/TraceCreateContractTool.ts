import {loadConfig} from "../../config/StatConfig";
import {createDB, initModel} from "../DBProvider";
import {Hex40Map} from "../../model/HexMap";
import {BlockTraceCreateSync} from "../BlockTraceCreateSync";
import {TraceCreateContract} from "../../model/TraceCreateContract";
// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {TokenTool} from "./TokenTool";
import {Op} from "sequelize";

let seq;
let cfx;
let networkId;
let tokenTool;
let type; // 1-block,2-transaction
let hash;
let epochNumber;
let service;

async function init() {
    const config = loadConfig('Prod')
    console.log(`config-----------${JSON.stringify(config)}`)
    seq = createDB(config.database)
    await seq.sync({})
    await initModel(seq)

    cfx = new Conflux({...config.conflux})
    tokenTool = new TokenTool(cfx);
    service = new BlockTraceCreateSync(cfx);
}

async function close(){
    Hex40Map.sequelize.close().then();
}

async function run() {
    await init();

    let result;
    if(type === 1){
        result = await cfx.traceBlock(hash);
    }
    if(type === 2) {
        result = await cfx.traceTransaction(hash);
    }
    if(type === 3){

    }
    if(type === 4){
        await checkTraceCreate();
    }

    console.log(`trace by hash completed...\ntype:${type}\nhash:${hash}\ntrace:${JSON.stringify(result)}`);
    await close();
}

async function checkTraceCreate(){
    const addressIdArray = await Hex40Map.findAll({attributes: ['id'], where : { hex: {[Op.like]: `8%`}}, raw: true});
    const lostAddressIdArray = [];
    for(const addressId of addressIdArray){
        const hex40 = await Hex40Map.findByPk(addressId.id);
        const hex40id = hex40.id;
        const hex = `0x${hex40.hex}`;
        const base32 = format.address(hex, networkId);

        let deployedByteCode;
        try {
            deployedByteCode = await cfx.getCode(base32);
        } catch (e) {
        }
        if(deployedByteCode === '0x' || deployedByteCode === undefined){
            continue;
        }

        const traceCreate = await TraceCreateContract.findOne({where : { to: hex40id}, raw: true});
        if(traceCreate === null){
            lostAddressIdArray.push(hex40id);
            console.log(`lost trace create: hex40id:${hex40id}, hex40:${hex}`);
        }
    }
    console.log(`lost trace create: lostAddressIdArray:${JSON.stringify(lostAddressIdArray)}`);
}


const args = process.argv.slice(2);
networkId = Number(args[0]);
if(args[1]){
    type = Number(args[1]);
}
if((type === 1 || type === 2) && args[2]){
    hash = args[2];
}
if(type === 3 && args[2]){
    epochNumber = Number(args[2]);
}

console.log(`params======networkId:${networkId}======type:${type}======hash:${hash}`);
run().then();
