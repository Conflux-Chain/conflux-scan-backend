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
let apiURL
let constructorArguements
let apikey
if(type === 2) {
    contractAddress = args[2]
}
if(type === 3 || type === 4) {
    apiURL = args[2]
    contractAddress = args[3]
    constructorArguements = args[4]
    if(args.length > 5) {
        apikey = args[5]
    }
}
if(type === 5) {
    apiURL = args[2]
    contractAddress = args[3]
    if(args.length > 4) {
        apikey = args[4]
    }
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
        await verifyBeaconProxy(apiURL, contractAddress, constructorArguements, apikey)
    }
    if(type === 4){
        await verifyUpgradeableBeacon(apiURL, contractAddress, constructorArguements, apikey)
    }
    if(type === 5){
        await verifyFixedPriceImpl(apiURL, contractAddress, apikey)
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
/*
zg-testnet-turbo(FixedPrice)
contractaddress: "0xBa697dB4e9293e6d7674045373508823A85d0798",
constructorArguements: "0000000000000000000000004d8e71b128e2d5b3c24034009d6103133d59374700000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000",
etherum-testnet-holesky(ChunkLinearReward)
contractaddress: "0x73C06F10568C5b466E1Cd77Fd8ff34Ab595aDEa8",
constructorArguements: "0000000000000000000000000d43cab9a38a2b65f756d36b40f6eed60d0d636500000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000",
*/
async function verifyBeaconProxy(apiURL, contractAddress, constructorArguements, apikey) {
    const contractname = "%40openzeppelin%2Fcontracts%2Fproxy%2Fbeacon%2FBeaconProxy.sol%3ABeaconProxy"
    const sourceCode = ""
    return verify(apiURL, contractname, contractAddress, sourceCode, constructorArguements, apikey)
}

/*
zg-testnet-turbo(FixedPriceBeacon)
contractaddress: "0x4D8e71B128E2D5B3c24034009d6103133D593747",
constructorArguements: "00000000000000000000000046b8579872dc1b8bd35f79e1a393c5ccac904e51",
etherum-testnet-holesky(ChunkLinearRewardBeacon)
contractaddress: "0x0D43CaB9a38a2b65f756D36b40f6eed60D0D6365",
constructorArguements: "00000000000000000000000083fc54521e3cd47f5b4f7176385153ec405fe6c6",
*/
async function verifyUpgradeableBeacon(apiURL, contractAddress, constructorArguements, apikey) {
    const contractname = "%40openzeppelin%2Fcontracts%2Fproxy%2Fbeacon%2FUpgradeableBeacon.sol%3AUpgradeableBeacon"
    const sourceCode = ""
    return verify(apiURL, contractname, contractAddress, sourceCode, constructorArguements, apikey)
}

/*
zg-testnet-turbo(FixedPriceImpl)
contractaddress: "0x46B8579872DC1B8BD35F79e1A393C5CCAc904E51",
constructorArguements: "",
etherum-testnet-holesky(FixedPriceImpl)
contractaddress: "0x8D53B61F044eBfE35E68dB9C998a5555c61d622F",
constructorArguements: "",
*/
async function verifyFixedPriceImpl(apiURL, contractAddress, apikey) {
    const contractname = "contracts%2Fmarket%2FFixedPrice.sol%3AFixedPrice"
    const sourceCode = ""
    return verify(apiURL, contractname, contractAddress, sourceCode, null, apikey)
}

const superagent = require('superagent');
require('superagent-proxy')(superagent);
/*
https://chainscan-test.0g.ai/open/api  zg-testnet
https://api-holesky.etherscan.io/api   etherum-testnet-holesky
*/
async function verify(apiURL, contractname, contractAddress, sourceCode, constructorArguements, apikey) {
    const req = {
        apikey: "",
        module: "contract",
        action: "verifysourcecode",
        codeformat: "solidity-standard-json-input",
        compilerversion: "v0.8.16%2Bcommit.07a7930e",
        contractname: "",
        contractaddress: "",
        sourceCode: "",
        constructorArguements: "",
    }
    req.contractname = contractname
    req.contractaddress = contractAddress
    req.sourceCode = sourceCode
    if(constructorArguements) {
        req.constructorArguements = constructorArguements
    }
    if(apikey) {
        req.apikey = apikey
    }

    Object.keys(req).forEach(key => {
        let val = req[key]
        val = decodeURIComponent(val)
        if(key === "compilerversion") {
            req[key] = val
        } else{
            req[key] = val.replaceAll("+", " ")
        }
    })

    return superagent
        .post(apiURL)
        //.proxy("http://127.0.0.1:7890")
        .set('Content-Type','application/x-www-form-urlencoded')
        .send(req)
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
