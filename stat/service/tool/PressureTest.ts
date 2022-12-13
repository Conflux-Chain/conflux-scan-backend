import {StatApp} from "../../StatApp";
import {Conflux, format, sign} from "js-conflux-sdk";
import {Hex40Map} from "../../model/HexMap";
import {loadConfig} from "../../config/StatConfig";
import {patchHttpProvider} from "../common/utils";
import {createDB, initModel} from "../DBProvider";
import {ContractQuery} from "../ContractQuery";
import {EpochSync} from "../EpochSync";

const lodash = require('lodash');
const superagent = require('superagent');
const XLSX = require("xlsx");
const TIMEOUT_CONN = 3000;
const TIMEOUT_READ = 3000;
const API_KEY = 'NB2Wbzc74i7RywdUwbBEyajxZD82rQzh35iACwT2qCXqFL1JZtViULqjYvoLEc7Qoo3bF6cJjdg5j7DDFWS1JY7Gv';

let bizType = '';
let parallel = 0;
let times = 0;
let debug = 0;

let counterSuccess = 0;
let counterFailed = 0;
let totalElapsed = 0;

async function init0() {
    const config = loadConfig('Prod')

    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)
}

// ------------------------- metrics profiler ----------------------------
const metrics = {
    /* eg.
    type: {
        seqId: {
            step1: {},
            step2: {},
            // ...
            step12: {},
        }
    }
    */
};

export function genSeqId(options){
    const reqParmaStr = Object.values(options).join('');
    const plain = `${reqParmaStr}${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const random = sign.keccak256(Buffer.from(plain)).toString('hex');
    return random.substr(0, 8);
}

export function profile(type, seq, step, elapsed){
    let typeObj = metrics[type];
    if(!typeObj){
        typeObj = {};
        metrics[type] = typeObj;
    }

    let seqObj = typeObj[seq];
    if(!seqObj) {
        seqObj = {};
        typeObj[seq] = seqObj;
    }

    let stepObj = seqObj[step];
    if(!stepObj) {
        stepObj = {elapsedArray: []};
        seqObj[step] = stepObj;
    }
    stepObj.elapsedArray.push(elapsed);

    return Date.now();
}

export async function reportXlsx() {
    metricXlsx();
    setTimeout(() => reportXlsx(), 60 * 1000);
}

export function metricXlsx() {
    console.log(`[metrics] raw metrics ${JSON.stringify(metrics)}`);
    const typeArray = Object.keys(metrics);
    if(!typeArray?.length) {
        console.log(`[metrics] no metrics ${new Date().toISOString()}`);
        return;
    }

    const metricSheets = {};
    for(const type of typeArray) {
        const typeObj = metrics[type];
        delete metrics[type];
        if(!typeObj) {
            console.log(`[metrics] type ${type} no metrics ${new Date().toISOString()}`);
            continue;
        }

        const metricSheet = {};
        const seqArray = Object.keys(typeObj);
        for (const seq of seqArray) {
            const seqObj = typeObj[seq];
            const stepArray = Object.keys(seqObj);

            for (const step of stepArray) {
                let stepStatObj = metricSheet[step];
                if(!stepStatObj) {
                    stepStatObj = {};
                    metricSheet[step] = stepStatObj;
                }

                const stepObj = seqObj[step];
                stepStatObj['times'] = stepStatObj['times'] ? (stepStatObj['times'] + stepObj['elapsedArray'].length) : stepObj['elapsedArray'].length;
                stepStatObj['elapsedMs'] = stepStatObj['elapsedMs'] ? (stepStatObj['elapsedMs'] + stepObj['elapsedArray'].reduce((a,b)=>a+b)) : stepObj['elapsedArray'].reduce((a,b)=>a+b);
                stepStatObj['averageLatency'] = stepStatObj['elapsedMs'] / stepStatObj['times'] ;
            }
        }

        const topStepArray = Object.keys(metricSheet).filter(step => step.split('-').length === 3);
        const totalAverageLatency = topStepArray.map(step=>metricSheet[step].averageLatency).reduce((a,b)=>a+b);
        metricSheet['average'] = {times: '-', elapsedMs: '-', averageLatency: totalAverageLatency};
        metricSheets[type] = metricSheet;
    }

    Object.keys(metricSheets)?.length && toCSVXlsx(metricSheets);
    console.log(`[metrics] metrics ${JSON.stringify(metricSheets)} ${new Date().toISOString()}`);
}

function toCSVXlsx(metricSheets){
    const workbook = XLSX.utils.book_new();

    const sheetNameArray = Object.keys(metricSheets).sort();
    for (const sheetName of sheetNameArray) {
        const sheetInfo = metricSheets[sheetName];

        const aoa = [['step', 'times', 'elapsed(ms)', 'averageLatency(ms)']];
        Object.keys(sheetInfo).sort().forEach(step => {
            const stepInfo = sheetInfo[step];
            const row = [step, stepInfo.times, stepInfo.elapsedMs, stepInfo.averageLatency];
            aoa.push(row);
        })

        const worksheet = XLSX.utils.aoa_to_sheet(aoa);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    }

    XLSX.writeFile(workbook, `./pressureTest-${Date.now()}.xlsx`);
    console.log(`done!`);
}

/*export async function report(type) {
    const typeWithPrefix = `${PREFIX}${type}`
    metric(typeWithPrefix);
    setTimeout(() => report(type), 60 * 1000);
}

export function metric(type) {
    const typeObj = metrics[type];
    if(!typeObj) {
        console.log(`[metrics] type ${type} no metrics ${new Date().toISOString()}`);
        return;
    }

    const seqArray = Object.keys(typeObj);
    // console.log(`[metrics] type ${type} metrics ${JSON.stringify(metrics)}`);

    const metricsOut = {};
    for (const seq of seqArray) {
        const seqObj = typeObj[seq];
        delete typeObj[seq];
        const stepArray = Object.keys(seqObj);

        for (const step of stepArray) {
            let stepStatObj = metricsOut[step];
            if(!stepStatObj) {
                stepStatObj = {};
                metricsOut[step] = stepStatObj;
            }

            const stepObj = seqObj[step];
            stepStatObj['times'] = stepStatObj['times'] ? (stepStatObj['times'] + 1) : 1;
            stepStatObj['elapsedMs'] = stepStatObj['elapsedMs'] ? (stepStatObj['elapsedMs'] + stepObj['elapsedMs']) : stepObj['elapsedMs'];
            stepStatObj['averageLatency'] = stepStatObj['elapsedMs'] / stepStatObj['times'] ;
        }
    }

    Object.keys(metricsOut)?.length && toCSV(type, metricsOut);
    console.log(`[metrics] type ${type} metrics ${JSON.stringify(metricsOut)} ${new Date().toISOString()}`);
}

function toCSV(fileName, metricObj){
    let content = '\ufeffstep,times,elapsed(ms),averageLatency(ms)\n';
    Object.keys(metricObj).sort().forEach(step => {
        const stepInfo = metricObj[step];
        content += `${step},${stepInfo.times},${stepInfo.elapsedMs},${stepInfo.averageLatency}\n`;
    });
    fs.writeFile(`./${fileName}-${new Date().getTime()}.csv`, content, (e) => console.error(`toCSV`, e));
    console.log(`done!`);
}*/

// ------------------------- pressure request ----------------------------
export const TEST_TYPE = {
    listTx: 'listTx',
    listTsCfx: 'listTsCfx',
    listTs20: 'listTs20',
    listTs721: 'listTs721',
    listTs1155: 'listTs1155',
    listToken: 'listToken',
    listNft: 'listNft',
    listNftBalance: 'listNftBalance',
}

const TEST_DATA = {
    [TEST_TYPE.listTx]: {
        url: 'http://127.0.0.1:29527/open/account/transactions',
        paramObjArray: [
            {
                account: 'cfx:aatr8pmpbpjjefvvb0bnc2ytv73rt7d3f2pjhyx1fr',
                skip: 0,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acgxme0vx2uychduh9thtzgx4yy0mkrgde0uxcza7d',
                skip: 200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaszpyf1jby9kpav8y751c87pmggp501ya932t0rua',
                skip: 400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acbw0byggmvac26kdxbsb8m9530s2md5kpp09e9010',
                skip: 600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaspg8fzpb6ertcd5adpuknnrw1nrbt8wux4jusge1',
                skip: 800,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aca45uhpk2d1j7vf8y927mr79w4bzne0vyfg9muytu',
                skip: 1000,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acfew93x2568cm09wgc3k97zzrjjgvesjy1acw5pb1',
                skip: 1200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aarrgvb7nzfvv9w1m3ykuk9tbfcf7yjvnpw1tnpbr3',
                skip: 1400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aceh8nb4e44reth6xkg7r8a99kv39323bee8zm933m',
                skip: 1600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aamv4cgp72zjne1derxf9y5n55d78z3wue66r82npj',
                skip: 1800,
                limit: 10,
                sort: 'DESC',
            },
        ]
    },
    [TEST_TYPE.listTsCfx]: {
        url: 'http://127.0.0.1:29527/open/account/cfx/transfers',
        paramObjArray: [
            {
                account: 'cfx:aatr8pmpbpjjefvvb0bnc2ytv73rt7d3f2pjhyx1fr',
                skip: 0,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acgxme0vx2uychduh9thtzgx4yy0mkrgde0uxcza7d',
                skip: 200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaszpyf1jby9kpav8y751c87pmggp501ya932t0rua',
                skip: 400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acbw0byggmvac26kdxbsb8m9530s2md5kpp09e9010',
                skip: 600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaspg8fzpb6ertcd5adpuknnrw1nrbt8wux4jusge1',
                skip: 800,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aca45uhpk2d1j7vf8y927mr79w4bzne0vyfg9muytu',
                skip: 1000,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acfew93x2568cm09wgc3k97zzrjjgvesjy1acw5pb1',
                skip: 1200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aarrgvb7nzfvv9w1m3ykuk9tbfcf7yjvnpw1tnpbr3',
                skip: 1400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aceh8nb4e44reth6xkg7r8a99kv39323bee8zm933m',
                skip: 1600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aamv4cgp72zjne1derxf9y5n55d78z3wue66r82npj',
                skip: 1800,
                limit: 10,
                sort: 'DESC',
            },
        ]
    },
    [TEST_TYPE.listTs20] : {
        url: 'http://127.0.0.1:29527/open/account/crc20/transfers',
        paramObjArray: [
            {
                account: 'cfx:aatr8pmpbpjjefvvb0bnc2ytv73rt7d3f2pjhyx1fr',
                skip: 0,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acgxme0vx2uychduh9thtzgx4yy0mkrgde0uxcza7d',
                skip: 200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaszpyf1jby9kpav8y751c87pmggp501ya932t0rua',
                skip: 400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acbw0byggmvac26kdxbsb8m9530s2md5kpp09e9010',
                skip: 600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaspg8fzpb6ertcd5adpuknnrw1nrbt8wux4jusge1',
                skip: 800,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aca45uhpk2d1j7vf8y927mr79w4bzne0vyfg9muytu',
                skip: 1000,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acfew93x2568cm09wgc3k97zzrjjgvesjy1acw5pb1',
                skip: 1200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aarrgvb7nzfvv9w1m3ykuk9tbfcf7yjvnpw1tnpbr3',
                skip: 1400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aceh8nb4e44reth6xkg7r8a99kv39323bee8zm933m',
                skip: 1600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aamv4cgp72zjne1derxf9y5n55d78z3wue66r82npj',
                skip: 1800,
                limit: 10,
                sort: 'DESC',
            },
        ]
    },
    [TEST_TYPE.listTs721]: {
        url: 'http://127.0.0.1:29527/open/account/crc721/transfers',
        paramObjArray: [
            {
                account: 'cfx:aatr8pmpbpjjefvvb0bnc2ytv73rt7d3f2pjhyx1fr',
                skip: 0,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acgxme0vx2uychduh9thtzgx4yy0mkrgde0uxcza7d',
                skip: 200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaszpyf1jby9kpav8y751c87pmggp501ya932t0rua',
                skip: 400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acbw0byggmvac26kdxbsb8m9530s2md5kpp09e9010',
                skip: 600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaspg8fzpb6ertcd5adpuknnrw1nrbt8wux4jusge1',
                skip: 800,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aca45uhpk2d1j7vf8y927mr79w4bzne0vyfg9muytu',
                skip: 1000,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acfew93x2568cm09wgc3k97zzrjjgvesjy1acw5pb1',
                skip: 1200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aarrgvb7nzfvv9w1m3ykuk9tbfcf7yjvnpw1tnpbr3',
                skip: 1400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aceh8nb4e44reth6xkg7r8a99kv39323bee8zm933m',
                skip: 1600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aamv4cgp72zjne1derxf9y5n55d78z3wue66r82npj',
                skip: 1800,
                limit: 10,
                sort: 'DESC',
            },
        ]
    },
    [TEST_TYPE.listTs1155]: {
        url: 'http://127.0.0.1:29527/open/account/crc1155/transfers',
        paramObjArray: [
            {
                account: 'cfx:aatr8pmpbpjjefvvb0bnc2ytv73rt7d3f2pjhyx1fr',
                skip: 0,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acgxme0vx2uychduh9thtzgx4yy0mkrgde0uxcza7d',
                skip: 200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaszpyf1jby9kpav8y751c87pmggp501ya932t0rua',
                skip: 400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acbw0byggmvac26kdxbsb8m9530s2md5kpp09e9010',
                skip: 600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aaspg8fzpb6ertcd5adpuknnrw1nrbt8wux4jusge1',
                skip: 800,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aca45uhpk2d1j7vf8y927mr79w4bzne0vyfg9muytu',
                skip: 1000,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:acfew93x2568cm09wgc3k97zzrjjgvesjy1acw5pb1',
                skip: 1200,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aarrgvb7nzfvv9w1m3ykuk9tbfcf7yjvnpw1tnpbr3',
                skip: 1400,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aceh8nb4e44reth6xkg7r8a99kv39323bee8zm933m',
                skip: 1600,
                limit: 10,
                sort: 'DESC',
            },
            {
                account: 'cfx:aamv4cgp72zjne1derxf9y5n55d78z3wue66r82npj',
                skip: 1800,
                limit: 10,
                sort: 'DESC',
            },
        ]
    },
    [TEST_TYPE.listNft]: {
        url: 'http://127.0.0.1:29527/open/nft/tokens',
        paramObjArray: [
            {
                contract: 'cfx:acgd354zys91dmd56gc049zdv686t9arr6axahp5up',
                skip: 0,
                limit: 10,
            },
            {
                contract: 'cfx:achz7e1fbkn1w7w3bbr67xe9ccfxvkcpru5hzdht1n',
                skip: 200,
                limit: 10,
            },
            {
                contract: 'cfx:acff8dvjv6pys2ws19dhx753h1h00sum6yhu3m188h',
                skip: 400,
                limit: 10,
            },
            {
                contract: 'cfx:ach5xttx9vgxuu18hg2hhegpavrv6c7d3urdj6zbu8',
                skip: 600,
                limit: 10,
            },
            {
                contract: 'cfx:acb7hr0ecyatev5gzjnys9mt31xxa22hzuzb3tprps',
                skip: 800,
                limit: 10,
            },
            {
                contract: 'cfx:acfz4c01t3165rn6779a18ev35n987hvmp6hry2axg',
                skip: 1000,
                limit: 10,
            },
            {
                contract: 'cfx:ace6p6egsuxv5hf61j332fayut6bxr3c7yv475a8cn',
                skip: 1200,
                limit: 10,
            },
            {
                contract: 'cfx:acddc76us49n4bysmyw2s7fy8sk9jk4vkexgfk3dd3',
                skip: 0,
                limit: 10,
            },
            {
                contract: 'cfx:acgx8dwws2j3znf9f5m6yej75jvbbkx96yvvntawmp',
                skip: 0,
                limit: 10,
            },
            {
                contract: 'cfx:acacgu2wvp53fxruj6raxfpjxf2u6ub6fuytzcvfec',
                skip: 0,
                limit: 10,
            },
        ]
    },
    [TEST_TYPE.listNftBalance]: {
        url: 'http://127.0.0.1:29527/open/nft/balances',
        paramObjArray: [
            {
                owner: 'cfx:aapwjebcay7d6jv02whjrrvkm9egmw5fye09cea6zz',
                skip: 80,
                limit: 10,
            },
            {
                owner: 'cfx:aajz68fv5j62h3828wj1beg7vr8hmvpg8agdkbc1zr',
                skip: 200,
                limit: 10,
            },
            {
                owner: 'cfx:aam2cnrarzburf6sspm6jg6eznbwht8uj6hf4jg8f2',
                skip: 400,
                limit: 10,
            },
            {
                owner: 'cfx:aana3t1ctuuuxmubvthtmkxupsmswaz4cj366ue247',
                skip: 600,
                limit: 10,
            },
            {
                owner: 'cfx:aajy1x1hty7g1ga9uemaf9s1v3x1e0g9vjzjhheue9',
                skip: 800,
                limit: 10,
            },
            {
                owner: 'cfx:aajwwe1spdxpcw5kb5unpctn5tr52p6r46nzasfvu1',
                skip: 1000,
                limit: 10,
            },
            {
                owner: 'cfx:aam1w9x58z2b1t0162hsw13hg9wka1htu26by7znpg',
                skip: 1200,
                limit: 10,
            },
            {
                owner: 'cfx:aakz626p1kb1u0614ccccuxs4zkbj25a8acvwnx6ms',
                skip: 0,
                limit: 10,
            },
            {
                owner: 'cfx:aam00za3adrx1mksvgzrkws55ascv90fteuxg7am89',
                skip: 0,
                limit: 10,
            },
            {
                owner: 'cfx:aaks5b94xzp8fh250e7fhp9sdeyaru30hpsb630me0',
                skip: 0,
                limit: 10,
            },
        ]
    },
    [TEST_TYPE.listToken]: {
        url: 'http://127.0.0.1:29527/open/account/tokens',
        paramObjArray: [
            {
                account: 'cfx:aatr8pmpbpjjefvvb0bnc2ytv73rt7d3f2pjhyx1fr',
            },
            {
                account: 'cfx:acgxme0vx2uychduh9thtzgx4yy0mkrgde0uxcza7d',
            },
            {
                account: 'cfx:aaszpyf1jby9kpav8y751c87pmggp501ya932t0rua',
            },
            {
                account: 'cfx:acbw0byggmvac26kdxbsb8m9530s2md5kpp09e9010',
            },
            {
                account: 'cfx:aaspg8fzpb6ertcd5adpuknnrw1nrbt8wux4jusge1',
            },
            {
                account: 'cfx:aca45uhpk2d1j7vf8y927mr79w4bzne0vyfg9muytu',
            },
            {
                account: 'cfx:acfew93x2568cm09wgc3k97zzrjjgvesjy1acw5pb1',
            },
            {
                account: 'cfx:aarrgvb7nzfvv9w1m3ykuk9tbfcf7yjvnpw1tnpbr3',
            },
            {
                account: 'cfx:aceh8nb4e44reth6xkg7r8a99kv39323bee8zm933m',
            },
            {
                account: 'cfx:aamv4cgp72zjne1derxf9y5n55d78z3wue66r82npj',
            },
        ]
    },
};

function init() {
    if(API_KEY) {
        const bizTypeArray = Object.keys(TEST_DATA);
        for (const bizType of bizTypeArray) {
            const paramObjArray = TEST_DATA[bizType]['paramObjArray'];
            for (const paramObj of paramObjArray) {
                paramObj['apiKey'] = API_KEY;
            }
        }
    }
}

async function pressureTest(bizType, parallel, loop) {
    let counterLoop = 0;
    do{
        const requestArray = [];
        for (let i = 0; i < parallel; i++) {
            requestArray.push(roundTrip(TEST_DATA[bizType].url, randomParam(bizType)));
        }
        console.log(`requestArray----------------- ${requestArray?.length}`)

        const elapsedArray = await Promise.all(requestArray);
        totalElapsed += elapsedArray.reduce((a,b)=>a+b, 0);

        counterLoop ++;
    } while (counterLoop < loop)

    const counterTotal = counterSuccess + counterFailed;
    console.log(`
        ${bizType} test done
        =================================
        threads ${parallel} times ${counterTotal}
        averageLatency ${totalElapsed/counterTotal} totalElapsed ${totalElapsed}
        success ${counterSuccess} fail ${counterFailed}
    `);
    reset();

    /*const requestArray = [];
    for (let i = 0; i < parallel; i++) {
        requestArray.push(roundTrip(TEST_DATA[bizType].url, randomParam(bizType)))
    }

    const elapsedArray = await Promise.all(requestArray);
    totalElapsed += elapsedArray.reduce((a,b)=>a+b, 0);

    const counterTotal = counterSuccess + counterFailed;
    if(counterTotal > times){
        console.log(`
        ${bizType} test done
        =================================
        threads ${parallel} times ${times}
        averageLatency ${totalElapsed/counterTotal} totalElapsed ${totalElapsed}
        success ${counterSuccess} fail ${counterFailed}
        `);
        reset();
        process.exit(0);
    }*/
}

async function roundTrip(url, paramObj) {
    const uri = `${url}?${Object.keys(paramObj).map(key => (`${key}=${paramObj[key]}`)).join('&')}`;

    let response;
    const start = Date.now()
    if(Object.keys(paramObj).length > 0) {
        response = await superagent.get(url)
            .query(paramObj)
            .timeout({response: TIMEOUT_CONN, deadline: TIMEOUT_READ})
            .catch(e => console.error(`uri ${uri} error`, e));
    } else {
        response = await superagent.get(url)
            .timeout({response: TIMEOUT_CONN, deadline: TIMEOUT_READ})
            .catch(e => console.error(`uri ${uri} error`, e));
    }

    const code = lodash.get(response, ['body', 'code']);
    if(response?.status === 200 && code === 0){
        counterSuccess ++;
    } else{
        counterFailed ++;
    }

    const elapsed = Date.now() - start;
    debug && console.log(`uri ${uri} code ${JSON.stringify(code)} elapsed ${elapsed}`)

    return elapsed;
}

function randomParam(bizType) {
    const paramObjArray = TEST_DATA[bizType].paramObjArray;
    const index = Math.floor(Math.random() * paramObjArray.length);
    return paramObjArray[index];
}

function reset() {
    counterSuccess = 0;
    counterFailed = 0;
    totalElapsed = 0;
}

async function run() {
    const bizTypeArray = Object.keys(TEST_DATA);
    if((!lodash.includes(bizTypeArray, bizType)) && (bizType !== 'all')){
        console.log(`only bizType [${bizTypeArray.join(',')},all] are supported`);
    }

    init();

    if(bizType !== 'all') {
        await pressureTest(bizType, parallel, times);
        return;
    }

    for (const bizType of bizTypeArray) {
        await pressureTest(bizType, parallel, times);
    }

    /*setTimeout(run, 1);*/
}

async function testParallel(loop) {
    await init0();
    const seqId = genSeqId(Date.now());
    let start = Date.now();

    const addressArray = [
        'cfx:aarjsge8xmrb5pw6u6zcws179uaf89vkvpyjty4p99',
        'cfx:aaj1sr5hdxe1b5p3wu25jt2kr91j6s81h2xkd3nmhz',
        'cfx:aanmnjth3xxstfdeehy62c0vzsebezawyyptmufat4',
        'cfx:aaprfex0avbwsa1zu132aajdcaas7havcpks4z0j81',
        'cfx:aamjg6bjzr4mygyckguudksn53mnvh52fp78px0h51'
    ];

    const hexArray = [
        '0x1a87189e9a9a1db25c872a293afdfc005f7e298b',
        '0x117737671cc970ed999431b43f096fee8e3bd73e',
        '0x16a5a1e7cce6e7946421e9cc0ad1ab88125412a5',
        '0x18d2927604432702f585f38001031000ee9c1113',
        '0x14837028ab74aa1a8249a101a5cbde54b89f782b'
    ];

    const taskArray = [];
    for(let i = 0; i < loop; i++) {
        const task = Promise.all(addressArray
            .map(async (address) => {
                if (address) {
                    start = Date.now();

                    const hex = format.hexAddress(address).substr(2);
                    start = profile('t1', seqId, 'step1-mem-formatHexAddress', start);

                    await Hex40Map.findOne({where: {hex}})
                    start = profile('t1', seqId, 'step2-db-Hex40Map', start);
                }
            })
        );
        taskArray.push(task);
    }

    await Promise.all(taskArray);

    metricXlsx();
}

if (module === require.main) {
    const args = process.argv.slice(2)

    StatApp.networkId = Number(args[0]);
    bizType = args[1];
    parallel = args[2] ? Number(args[2]) : 0;
    times = args[3] ? Number(args[3]) : 0;
    debug = args[4] ? Number(args[4]) : 0;

    if(bizType === 'testParallel') {
        testParallel(parallel).then();
    } else{
        run().then();
    }
}
