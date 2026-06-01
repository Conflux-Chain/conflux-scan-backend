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
import {ethers, keccak256} from "ethers";
import {Contract} from "../../model/Contract";
import {Op, Sequelize} from "sequelize";
import {execSync} from "child_process";
import {sleep} from "./ProcessTool";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {NameTag} from "../../model/NameTag";
import {
    AbiSignature,
    IAbiSignature,
    saveAbiAnnounce,
    saveAbiSigs,
    saveContractAbiSigs,
} from "../../model/ContractInfo";
import {ContractTraceCreateQuery} from "../ContractTraceCreateQuery";
import {AddressTransactionIndex} from "../../model/FullBlock";
import {PruneInfo, PruneType} from "../../model/PruneInfo";
import {TokenTool} from "./TokenTool";

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
let dryRun = false;
if (type === 2) {
    compiler = args[2]
}
if (type === 3) {
    if (args[2] !== undefined) {
        lastId = Number(args[2])
    }
}
if (type === 7) {
    if (args[2] !== undefined) {
        lastId = Number(args[2])
    }
}
if (type === 8) {
    if (args[2] !== undefined) {
        dryRun = args[2] === 'true';
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
    if (type === 6) {
        await addVerifiedColumns()
    }
    if (type === 7) {
        await extractContractAbi()
    }
    if (type === 8) {
        await syncAnnouncedAbi()
    }
    await close();
}

let cfx: Conflux;
let contractQuery: ContractQuery;
let traceCreate: ContractTraceCreateQuery;
let tokenTool: TokenTool;

async function init() {
    const config: StatConfig = await initialize()

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);

    cfx = await initCfxSdk(config.conflux);
    contractQuery = new ContractQuery({cfx, config: config.verification});
    traceCreate = new ContractTraceCreateQuery(cfx);
    tokenTool = new TokenTool(cfx);
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
        const {address, methodId, signature, method} = contract as any;
        const arr: IAbiSignature[] = [{
            type: 'function',
            fullFormatHash: keccak256(Buffer.from(method)),
            fullFormat: method,
            hash: methodId,
            signature: signature,
        }];
        const sigs = await AbiSignature.bulkCreate(arr, {updateOnDuplicate: ['updatedAt']});
        const contractId = await makeIdV(address);
        await saveContractAbiSigs(sigs, contractId);
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

async function addVerifiedColumns() {
    const axios = require('axios');
    const baseUrl = "https://www.confluxscan.net/verification";

    const list = await VerifiedContracts.findAll({
        attributes: ['id', 'address', 'name', 'language', [Sequelize.fn('LEFT', Sequelize.col('sourceCode'), 5), 'sourceCode']],
        order: [['id', 'ASC']],
    });
    console.log(`start to process ${list.length} contracts ...`);

    for (let i = 0; i < list.length; i++) {
        const {id, address: base32, name, sourceCode} = list[i];

        const address = ethers.getAddress(format.hexAddress(base32));
        const queryUrl = `${baseUrl}/contract/${StatApp.networkId}/${address}?fields=compilation`;

        while (true) {
            try {
                const resp = await axios.get(queryUrl, {family: 4, headers: {'Accept': 'application/json'}});
                const {matchId, address: respAddress, match, compilation, verifiedAt} = resp.data;
                if (respAddress !== address) {
                    console.log(`contract ${name} ${base32} address not match. expect ${address} got ${respAddress}`);
                    process.exit(9);
                }
                if (!match) {
                    console.log(`contract ${name} ${base32} not verified`);
                    process.exit(9);
                }

                const addressId = await makeIdV(format.hexAddress(base32));

                const createInfo = await traceCreate.query(base32);
                const {epochNumber, from} = createInfo;

                const count = await AddressTransactionIndex.count({where: {addressId}});
                const pruneInfo = await PruneInfo.findOne({where: {addressId, type: PruneType.ADDR_TX}});
                const txns = count + (pruneInfo?.pruned || 0);

                const contract = await Contract.findOne({attributes: ['name'], where: {hex40id: addressId}, raw: true});
                const nametag = await NameTag.findOne({where: {hex40id: addressId}, raw: true});
                const hasNametag = Boolean(contract?.name || nametag?.nameTag || nametag?.labels);

                await VerifiedContracts.update({
                    addressId,
                    codeFormat: `${compilation.language}${sourceCode.startsWith("{") ? "(Json)" : ""}`,

                    matchId,
                    compiler: compilation.compiler,
                    verifiedAt: verifiedAt.replace('T', ' ').replace(/T$/, ''),

                    epochNumber,
                    deployer: from,
                    txns,
                    hasNametag,
                }, {
                    where: {id}
                });
                break;
            } catch (e) {
                if (e.status === 404) {
                    console.log(`fetch contract ${name} ${base32} not found`);
                    break;
                }

                console.log(`fetch contract ${name} ${base32} error`, e);
            }
        }

        if ((i + 1) % 1000 === 0) {
            console.log(`${i} contracts processed`);
        }
    }

    console.log(`done! ${list.length} contracts processed`);
}

async function extractContractAbi() {
    if (lastId < 0) {
        return
    }

    const batchSize = 10;
    let processedCount = 0;

    while (true) {
        const contracts = await VerifiedContracts.findAll({
            attributes: ["id", "addressId", "abi"],
            where: {id: {[Op.gt]: lastId}},
            order: [["id", "asc"]],
            limit: batchSize,
            raw: true
        });

        if (!contracts?.length) {
            break;
        }

        for (const c of contracts) {
            const {addressId, abi} = c;
            await saveAbiSigs(abi, addressId);
        }

        lastId = contracts[contracts.length - 1].id;

        processedCount += contracts.length;
        if (processedCount % 1000 === 0) {
            console.log(`${processedCount} contracts processed`);
        }
    }

    console.log(`done! ${processedCount} contracts processed`);
}

async function syncAnnouncedAbi() {
    const chainInfo = CONST.CHAIN_INFO[StatApp.networkId];
    if (!chainInfo.C_ANNOUNCE) {
        console.log("Failed to find announcement contract");
        return;
    }

    const addressInfo = await Hex40Map.findOne({
        where: {hex: format.hexAddress(chainInfo.C_ANNOUNCE).slice(2)},
        raw: true
    });
    if (!addressInfo) {
        console.log("Failed to find announcement address");
        return;
    }

    const txs = await AddressTransactionIndex.findAll({
        attributes: ["epoch"],
        where: {addressId: addressInfo.id},
        raw: true
    });
    if (!txs?.length) {
        console.log("Failed to find announcement txs");
        return;
    }

    console.log("Start to process announcement txs", txs.length);

    const epochs = [...new Set(txs.map((t: any) => t.epoch))];
    for (const epochNumber of epochs) {
        const epochReceipts = await cfx.getEpochReceipts(epochNumber);

        const announcements = [];
        for (let blockReceipts of epochReceipts) {
            for (let txReceipt of blockReceipts) {
                if (txReceipt.outcomeStatus !== 0) {
                    continue;
                }
                for (let log of txReceipt.logs) {
                    let transfer;
                    if ((transfer = tokenTool.decodeAnnouncePlus(log))) {
                        announcements.push(transfer);
                    }
                }
            }
        }

        for (const announcement of announcements) {
            const key = Buffer.from(announcement.key, 'base64').toString();
            if (key === 'contract/abi') {
                const plain = Buffer.from(announcement.value, 'base64').toString();
                await saveAbiAnnounce(plain, epochNumber, dryRun);
            }
        }
    }

    console.log(`done! ${txs.length} txs processed`);
}
