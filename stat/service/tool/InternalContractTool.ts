import {format} from "js-conflux-sdk";
import {Hex40Map, makeId} from "../../model/HexMap";
import {Contract} from "../../model/Contract";
import {init} from "./FixDailyTokenStat";
import {ContractVerify} from "../../model/ContractVerify";
const AdminControl = require("../abi/AdminControl");
const SponsorWhitelistControl = require("../abi/SponsorWhitelistControl");
const Staking = require("../abi/Staking");
// const ReentrancyConfig = require("../abi/ReentrancyConfig");
const ConfluxContext = require("../abi/ConfluxContext");
const PoSRegister = require("../abi/PoSRegister");
const CrossSpaceCall = require("../abi/CrossSpaceCall");
const fs = require('fs');

let networkId;
const internalContractArray = [
    {
        address: '0x0888000000000000000000000000000000000000',
        name: 'AdminControl',
        website: 'https://developer.conflux-chain.org/docs/conflux-rust/internal_contract/internal_contract',
        abi: JSON.stringify(AdminControl.abi),
    },
    {
        address: '0x0888000000000000000000000000000000000001',
        name: 'SponsorWhitelistControl',
        website: 'https://developer.conflux-chain.org/docs/conflux-rust/internal_contract/internal_contract',
        abi: JSON.stringify(SponsorWhitelistControl.abi),
    },
    {
        address: '0x0888000000000000000000000000000000000002',
        name: 'Staking',
        website: 'https://developer.conflux-chain.org/docs/conflux-rust/internal_contract/internal_contract',
        abi: JSON.stringify(Staking.abi),
    },
    // https://github.com/Conflux-Chain/CIPs/blob/master/CIPs/cip-64.md
    {
        address: '0x0888000000000000000000000000000000000004',
        name: 'ConfluxContext',
        website: 'https://developer.conflux-chain.org/docs/conflux-rust/internal_contract/internal_contract',
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
        website: 'https://developer.conflux-chain.org/docs/conflux-rust/internal_contract/internal_contract',
        abi: JSON.stringify(PoSRegister.abi),
    },
    {
        address: '0x0888000000000000000000000000000000000006',
        name: 'CrossSpaceCall',
        website: 'https://developer.conflux-chain.org/docs/conflux-rust/internal_contract/internal_contract',
        abi: JSON.stringify(CrossSpaceCall.abi),
    },
];

async function registerContract(contract) {
    const hex40id =  (await makeId(contract.address)).id;
    const base32 = format.address(contract.address, networkId);
    const newContract = {
        epoch: 0,
        hex40id,
        base32,
        name: contract.name,
        website: contract.website,
        abi: contract.abi,
    };
    await Contract.upsert(newContract);

    const sourceCode = await fs.readFileSync(`../../../../contracts/${contract.name}.sol`);
    const newContractVerify = {
        name: contract.name,
        base32,
        compiler: 'solidity',
        version: 'v0.8.0+commit.c7dfd78e',
        sourceCode: sourceCode.toString().trim(),
        abi: contract.abi,
        verifyResult: true,
        similarity: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await ContractVerify.upsert(newContractVerify);
}

async function close(){
    Hex40Map.sequelize.close().then();
}

async function run() {
    // init
    await init();
    // do business
    for (const contract of internalContractArray) {
        await registerContract(contract);
    }
    // release
    await close();
}

// get parameter
const args = process.argv.slice(2);
networkId = Number(args[0]);
// run
run().then();
