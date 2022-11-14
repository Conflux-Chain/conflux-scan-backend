import {StatApp} from "../../StatApp";

const lodash = require('lodash');
const superagent = require('superagent');
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

const TEST_DATA = {
    // account
    'listTs20': {
        url: 'http://127.0.0.1:9527/open/account/crc20/transfers',
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
    'listTs721': {
        url: 'http://127.0.0.1:9527/open/account/crc721/transfers',
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
    'listTs1155': {
        url: 'http://127.0.0.1:9527/open/account/crc1155/transfers',
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
    'listTx': {
        url: 'http://127.0.0.1:9527/open/account/transactions',
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
    'listTsCfx': {
        url: 'http://127.0.0.1:9527/open/account/cfx/transfers',
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
    'listTokens': {
        url: 'http://127.0.0.1:9527/open/account/tokens',
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
    // nft
    'listNfts': {
        url: 'http://127.0.0.1:9527/open/nft/tokens',
        paramObjArray: [
            {
                contract: 'cfx:aatr8pmpbpjjefvvb0bnc2ytv73rt7d3f2pjhyx1fr',
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
    'listNftBalances': {
        url: 'http://127.0.0.1:9527/open/nft/balances',
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
};

function init() {
    if(API_KEY) {
        const bizTypeArray = Object.keys(TEST_DATA);
        for (const bizType of bizTypeArray) {
            const paramObjArray = TEST_DATA[bizType]['paramObjArray'];
            for (const paramObj in paramObjArray) {
                paramObj['apiKey'] = API_KEY;
            }
        }
    }
}

async function pressureTest(bizType, parallel, times) {
    let counterTotal;
    do{
        const requestArray = [];
        for (let i = 0; i < parallel; i++) {
            requestArray.push(roundTrip(TEST_DATA[bizType].url, randomParam(bizType)));
        }

        const elapsedArray = await Promise.all(requestArray);
        totalElapsed += elapsedArray.reduce((a,b)=>a+b, 0);

        counterTotal = counterSuccess + counterFailed;
    } while (counterTotal <= times)

    console.log(`
        ${bizType} test done
        =================================
        threads ${parallel} times ${times}
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

const args = process.argv.slice(2)
StatApp.networkId = Number(args[0]);
bizType = args[1];
parallel = Number(args[2]);
times = Number(args[3])
debug = args[4] ? Number(args[4]) : 0;

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

run().then();