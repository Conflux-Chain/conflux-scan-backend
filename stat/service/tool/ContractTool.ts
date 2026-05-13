import {Hex40Map, makeId, makeIdV} from "../../model/HexMap";
import {init as initialize} from "./FixDailyTokenStat";
import {StatApp} from "../../StatApp";
import {StatConfig} from "../../config/StatConfig";
import {initCfxSdk} from "../common/utils";
import {CONST} from "../common/constant";
import {ContractQuery, ImplInfo} from "../ContractQuery";
import {IS_EVM2, KV} from "../../model/KV";
import {VerifiedContracts} from "../../model/VerifiedContracts";
import {Conflux, format} from "js-conflux-sdk";
import {ethers} from "ethers";
import {Contract} from "../../model/Contract";
import {Op} from "sequelize";
import {execSync} from "child_process";
import {sleep} from "./ProcessTool";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {NameTag} from "../../model/NameTag";
import {AbiInfo, IAbiInfo, saveContractAbiRef, UPDATE_FIELDS_FOR_DUPLICATE_ABI} from "../../model/ContractInfo";

const fs = require('fs');
const path = require('path');

/**
 * arguments
 */
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0])
const type = Number(args[1])
let lastId = -1
let compiler
if (type === 2) {
    compiler = args[2]
}
if (type === 3) {
    if (args[2] !== undefined) {
        lastId = Number(args[2])
    }
}

/**
 * process
 */
run().then();

async function run() {
    await init();
    if (type === 1) {
        await initContracts()
        await initPrecompiledAbi()
    }
    if (type === 2) {
        await fetchCompilers()
    }
    if (type === 3) {
        await verifyFromScan()
    }
    if (type === 4) {
        await realtimeProxyImpl()
    }
    if (type === 5) {
        await updateNametagHexId()
    }
    await close();
}

let cfx: Conflux;
let contractQuery: ContractQuery;

async function init() {
    const config: StatConfig = await initialize()

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);

    cfx = await initCfxSdk(config.conflux);
    contractQuery = new ContractQuery({cfx, config: config.verification});
}

async function close() {
    Hex40Map.sequelize.close().then();
}

/**
 * init internal / genesis contracts
 */
async function initContracts() {
    let contracts: any[];

    if (!StatApp.isEVM) {
        const INTERNAL = Object.keys(CONST.INTERNAL_NAME_CONTRACT_MAP)
            .map(n => ({...CONST.INTERNAL_NAME_CONTRACT_MAP[n], name: n})).filter((item: any) => item.space === 'core');
        const GENESIS = Object.keys(CONST.GENESIS_ADDR_CONTRACT_MAP)
            .map(a => ({...CONST.GENESIS_ADDR_CONTRACT_MAP[a], address: a}));
        contracts = [...INTERNAL, ...GENESIS];
    } else {
        const INTERNAL = Object.keys(CONST.INTERNAL_NAME_CONTRACT_MAP)
            .map(n => ({...CONST.INTERNAL_NAME_CONTRACT_MAP[n], name: n})).filter((item: any) => item.space === 'evm');
        const precompiled = Object.keys(CONST.PRECOMPILED_NAME_CONTRACT_MAP)
            .map(n => CONST.PRECOMPILED_NAME_CONTRACT_MAP[n]);
        contracts = [...INTERNAL, ...precompiled];
    }

    for (const c of contracts) {
        const base32 = format.address(c.address, StatApp.networkId);
        const hex40id = (await makeId(c.address)).id;
        const contract = {
            epoch: 0,
            base32,
            hex40id
        } as Contract;

        c.name && (contract.name = c.name);
        let sourceCode;
        if (c.address.startsWith('0x08') ||
            c.address.startsWith('0x1820') ||
            c.address === "0x8a3a92281df6497105513b18543fd3b60c778e40"
        ) {
            const path = `../../../common/contracts${c.address.startsWith('0x08') ? "/internal" : ""}/${c.name}.sol`;
            sourceCode = fs.readFileSync(path);
            sourceCode = sourceCode.toString().trim();
        }
        sourceCode && (contract.sourceCode = sourceCode);
        c.abi && (contract.abi = c.abi);
        c.website && (contract.website = c.website);

        await Contract.upsert(contract);
    }
}

async function initPrecompiledAbi() {
    for (const [name, contract] of Object.entries(CONST.PRECOMPILED_NAME_CONTRACT_MAP)) {
        const {address, methodId, signature, method } = contract as any;
        const arr: IAbiInfo[] = [{
            type: 'function',
            fullName: signature,
            hash: methodId,
            formatWithArg: method
        }];
        const abiInfos = await AbiInfo.bulkCreate(arr, { updateOnDuplicate: UPDATE_FIELDS_FOR_DUPLICATE_ABI });
        const contractId = await makeIdV(address);
        await saveContractAbiRef(abiInfos, contractId);
        console.log(`Precompiled contract ${name} abi added!`)
    }
}

const URL_VYPER_VERSIONS = 'https://github.com/vyperlang/vyper/releases/download';
const URL_SOLC_VERSIONS = 'https://binaries.soliditylang.org/linux-amd64'; // append /solc-linux-amd64-v0.8.6%2Bcommit.11564f7e

async function fetchCompilers() {
    let versions;
    let commands;

    if (compiler === "vyper") {
        versions = await contractQuery.listVyperVersions();
        commands = Object.keys(versions)
            .map(ver => `proxychains4 curl -O -L "${URL_VYPER_VERSIONS}/v${ver}/vyper.${ver}+commit.${versions[ver].commit}.linux"`);
    } else if (compiler === "solc") {
        versions = await contractQuery.listSolcVersions();
        commands = Object.values(versions)
            .map(ver => `proxychains4 curl -O -L "${URL_SOLC_VERSIONS}/solc-linux-amd64-${ver}"`);
    } else {
        throw new Error(`Contract compiler type ${compiler} not supported.`);
    }

    console.log(`Cmd to exec: ${commands.length}`);
    const {suc, fai} = executeCommands(commands);
    console.log('\nExec Summary:\n', {suc, fai});
}

function executeCommands(commands) {
    let suc = 0;
    let fai = 0;

    commands.forEach((cmd, index) => {
        console.log(`Executing command ${index + 1}/${commands.length}: ${cmd}`);
        try {
            execSync(cmd, {stdio: 'inherit'});
            console.log(`Command ${index + 1} succeeded`);
            suc++;
        } catch (error) {
            console.error(`Command ${index + 1} failed: ${error.message}`);
            fai++;
        }
    });

    return {suc, fai};
}

async function verifyFromScan(submitVerify: boolean = true) {
    const axios = require('axios');
    const baseUrl = "https://www.confluxscan.net/verification";
    const missing = `${path.dirname(__filename)}/verify.missing`;

    while (true) {
        const list = await VerifiedContracts.findAll({
            attributes: ['id', 'address', 'name'],
            where: {id: {[Op.gt]: lastId},}, offset: 0, limit: 1000, order: [['id', 'ASC']],
        });

        const size = list?.length;
        if (!size) {
            return;
        }

        console.log(`start to process ${size} contracts ${list[0].id} ${list[size - 1].id}...`);
        for (let i = 0; i < size; i++) {
            const {id, address, name} = list[i];

            const contract = ethers.getAddress(format.hexAddress(address));
            const queryUrl = `${baseUrl}/contract/${StatApp.networkId}/${contract}`;
            const verifyUrl = `${baseUrl}/verify/confluxscan/${StatApp.networkId}/${contract}`;

            while (true) {
                try {
                    await axios.get(queryUrl, {family: 4, headers: {'Accept': 'application/json'}});
                } catch (e) {
                    if (e.status !== 404) {
                        console.log(`http err ${queryUrl} ${e.code} ${e.status}`);
                        await sleep(1000);
                        continue;
                    }

                    if (!submitVerify) {
                        fs.appendFileSync(missing, `${contract}, ${name}\n`);
                        console.log('missing verified', {contract, name, url: queryUrl});
                        break;
                    }

                    while (true) {
                        try {
                            const response = await axios.post(verifyUrl, undefined, {
                                family: 4,
                                headers: {'Accept': 'application/json'}
                            });

                            const {verificationId} = response.data;
                            const {error, match} = await contractQuery.getVerificationResult(verificationId);
                            if (error?.includes("Pending in queue")) {
                                await sleep(1000);
                                continue;
                            }

                            if (!match && !error?.includes("already_verified")) {
                                fs.appendFileSync(missing, `${contract}, ${name}\n`);
                                console.log('missing verified', {contract, name, url: queryUrl});
                            }
                        } catch (error) {
                            console.log(`http err ${verifyUrl} ${error.code} ${error.status}`);
                            await sleep(1000);
                            continue;
                        }

                        break;
                    }
                }

                break;
            }

            lastId = id;
        }
    }
}

async function realtimeProxyImpl() {
    const traces = await TraceCreateContract.findAll({attributes: ['to'], raw: true});

    let total = 0;
    let proxy = 0;
    let beaconProxy = 0;

    for (const {to} of traces) {
        total ++;
        const hex = await Hex40Map.findOne({where: {id: to}, raw: true});
        const impl: ImplInfo = await contractQuery.getImpl(`0x${hex.hex}`);
        if (impl) {
            proxy++;
            const {beacon} = impl;
            if (beacon) {
                beaconProxy++;
            }
        }
    }

    console.log(`done! ${JSON.stringify({total, proxy, beaconProxy})}`);
}

async function updateNametagHexId() {
    const list = await NameTag.findAll({
        attributes: ['id', 'base32'],
        raw: true,
    });

    let cntr = 0;
    for (const item of list) {
        const {id, base32} = item;
        if (base32.length !== 64) {
            const hex = format.hexAddress(base32);
            const hexObj = await Hex40Map.findOne({where: {hex: hex.substr(2)}, raw: true});
            if (!hexObj) {
                console.log(`Failed to find address, ${base32}, ${hex}`);
            } else {
                await NameTag.update({hex40id: hexObj.id}, {where: {id}});
            }
            cntr++;
        }
    }

    console.log(`Done! ${cntr}`);
}
