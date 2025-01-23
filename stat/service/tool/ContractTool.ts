import {format} from "js-conflux-sdk";
import {Hex40Map, makeId} from "../../model/HexMap";
import {Contract} from "../../model/Contract";
import {init as initialize} from "./FixDailyTokenStat";
import {ContractVerify} from "../../model/ContractVerify";
import {StatApp} from "../../StatApp";
import {StatConfig} from "../../config/StatConfig";
import {initCfxSdk} from "../common/utils";
import {ContractQuery} from "../ContractQuery";
import {IS_EVM2, KV} from "../../model/KV";

const fs = require('fs');
const AdminControl = require("../abi/AdminControl");
const SponsorWhitelistControl = require("../abi/SponsorWhitelistControl");
const Staking = require("../abi/Staking");
const ConfluxContext = require("../abi/ConfluxContext");
const PoSRegister = require("../abi/PoSRegister");
const CrossSpaceCall = require("../abi/CrossSpaceCall");
const ParamsControl = require("../abi/ParamsControl");
const Create2Factory = require("../abi/Create2Factory");

/**
 * arguments
 */
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0])
const type = Number(args[1])
let contractAddress
if(type === 2) {
    contractAddress = args[2]
}
let apiURL
let pathToRequestJson
if(type === 3) {
    apiURL = args[2]
    pathToRequestJson = args[3]
}

/**
 * process
 */
run().then();
async function run() {
    await init();
    if(type === 1){
        await registerContracts()
    }
    if(type === 2){
        await implementation(contractAddress)
    }
    if(type === 3){
        await sendVerifyRequest(apiURL, pathToRequestJson)
    }
    await close();
}
let cfx
let contractQuery
async function init() {
    const config: StatConfig = await initialize()

    cfx = await initCfxSdk(config.conflux);
    contractQuery = new ContractQuery({cfx});

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
}
async function close(){
    Hex40Map.sequelize.close().then();
}

/**
 * internal
 */
const internalContractArray = [
    {
        address: '0x0888000000000000000000000000000000000000',
        name: 'AdminControl',
        website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
        abi: JSON.stringify(AdminControl.abi),
    },
    {
        address: '0x0888000000000000000000000000000000000001',
        name: 'SponsorWhitelistControl',
        website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
        abi: JSON.stringify(SponsorWhitelistControl.abi),
    },
    {
        address: '0x0888000000000000000000000000000000000002',
        name: 'Staking',
        website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
        abi: JSON.stringify(Staking.abi),
    },
    // https://github.com/Conflux-Chain/CIPs/blob/master/CIPs/cip-64.md
    {
        address: '0x0888000000000000000000000000000000000004',
        name: 'ConfluxContext',
        website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
        abi: JSON.stringify(ConfluxContext.abi),
    },
    // // https://github.com/Conflux-Chain/CIPs/blob/master/CIPs/cip-71.md
    // // Parameters: BLOCK_NUMBER_CIP71A, BLOCK_NUMBER_CIP71B.
    // // a. Enable the new internal contracts and disable the anti-reentrancy for contracts allowing reentrancy. Should be activated when block_numer >= BLOCK_NUMBER_CIP71A.
    // // b. Fix incorrect behaviour in the current implementation of anti-reentrancy, when block_number >= BLOCK_NUMBER_CIP71B.
    // {
    //     address: '0x0888000000000000000000000000000000000004',
    //     name: 'ReentrancyConfig',
    //     website: 'https://developer.conflux-chain.org/docs/conflux-rust/internal_contract/internal_contract',
    //     abi: JSON.stringify(ReentrancyConfig.abi),
    // },
    {
        address: '0x0888000000000000000000000000000000000005',
        name: 'PoSRegister',
        website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
        abi: JSON.stringify(PoSRegister.abi),
    },
    {
        address: '0x0888000000000000000000000000000000000006',
        name: 'CrossSpaceCall',
        website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
        abi: JSON.stringify(CrossSpaceCall.abi),
    },
    {
        address: '0x0888000000000000000000000000000000000007',
        name: 'ParamsControl',
        website: 'https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts',
        abi: JSON.stringify(ParamsControl.abi),
    },
    {
        address: '0x8A3A92281Df6497105513B18543fd3B60c778E40',
        name: 'Create2Factory',
        website: 'https://github.com/Conflux-Chain/CIPs/blob/master/CIPs/cip-31.md',
        abi: JSON.stringify(Create2Factory.abi),
    },
];
async function registerContracts() {
    for (const contract of internalContractArray) {
        if(contract.name === 'ConfluxContext'){
            await registerContract(contract);
        }
    }
}
async function registerContract(contract) {
    const hex40id =  (await makeId(contract.address)).id;
    const base32 = format.address(contract.address, StatApp.networkId);
    const newContract = {
        epoch: 0,
        hex40id,
        base32,
        name: contract.name,
        website: contract.website,
        abi: contract.abi,
    };

    const [, r1] = await Contract.upsert(newContract);
    console.log(`newContract ---1--- r1 ${r1}, ${JSON.stringify(newContract)}`)

    const sourceCode = await fs.readFileSync(`../../../contracts/${contract.name}.sol`);
    const newContractVerify = {
        name: contract.name,
        base32,
        compiler: 'solidity',
        version: 'v0.8.0+commit.c7dfd78e',
        sourceCode: sourceCode.toString().trim(),
        abi: contract.abi,
        verifyResult: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    const [, r2] = await ContractVerify.upsert(newContractVerify);
    console.log(`newContractVerify ---2--- r1 ${r2},  ${JSON.stringify(newContractVerify)}`)
}

/**
 * implementation
 */
async function implementation(address) {
    const impl = await contractQuery.queryImplementation(address)
    console.log(`address ${address} impl ${JSON.stringify(impl)}`);
}

/**
 * verify
 */
async function sendVerifyRequest(apiURL, pathToRequestJson) {
    const request = require(pathToRequestJson);
    console.log(`pathToRequestJson ${pathToRequestJson}`)
    console.log(`request ${JSON.stringify(request)}`)
    return verify(apiURL, request)
}

const superagent = require('superagent');
require('superagent-proxy')(superagent);

async function verify(apiURL, request) {
    return superagent
        .post(apiURL)
        //.proxy("http://127.0.0.1:7890")
        .set('Content-Type','application/x-www-form-urlencoded')
        .send(request)
        .timeout(600 * 1000).then(
            response => {
                if(response.status === 200) {
                    console.log(`responseText  ${response.text}`)
                } else{
                    console.log(`response.status ${typeof response.status}`)
                }
            }
        )
}
