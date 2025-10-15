import {Hex40Map, makeId} from "../../model/HexMap";
import {init as initialize} from "./FixDailyTokenStat";
import {StatApp} from "../../StatApp";
import {StatConfig} from "../../config/StatConfig";
import {initCfxSdk} from "../common/utils";
import {CONST} from "../common/constant";
import {ContractQuery, VerificationJob, VerifyInput} from "../ContractQuery";
import {IS_EVM2, KV} from "../../model/KV";
import {VerifiedContracts} from "../../model/VerifiedContracts";
import {format} from "js-conflux-sdk";
import {ethers} from "ethers";
import {Contract} from "../../model/Contract";
import {sleep} from "./ProcessTool";
import {Op} from "sequelize";
import {execSync} from "child_process";

const fs = require('fs');
const path = require('path');

/**
 * arguments
 */
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0])
const type = Number(args[1])
let lastId = -1
let url
if(type === 2 && args[2] !== undefined) {
    lastId = Number(args[2])
}
if(type ===4) {
    // evm space: https://evmapi.confluxscan.net/api?module=contract&action=getabi&
    // core space: https://api.confluxscan.org/contract/getabi?
    url = args[2]
    if(args[3] !== undefined) {
        lastId = Number(args[3])
    }
}

/**
 * process
 */
run().then();
async function run() {
    await init();
    if(type === 1){
        await initContracts()
    }
    if(type === 2){
        await verifyBySourcify()
    }
    if(type === 3){
        await fetchCompilers()
    }
    if(type === 4){
        await missingVerified()
    }
    await close();
}
let cfx
let contractQuery
async function init() {
    const config: StatConfig = await initialize()

    cfx = await initCfxSdk(config.conflux);
    contractQuery = new ContractQuery({cfx, config});

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
}
async function close(){
    Hex40Map.sequelize.close().then();
}

/**
 * init internal / genesis contracts
 */
async function initContracts() {
    let contracts: any[]

    if(!StatApp.isEVM) {
        const INTERNAL = Object.keys(CONST.INTERNAL_NAME_CONTRACT_MAP)
            .map(n => ({...CONST.INTERNAL_NAME_CONTRACT_MAP[n], name: n})).filter((item: any) => item.space === 'core')
        const GENESIS = Object.keys(CONST.GENESIS_ADDR_CONTRACT_MAP)
            .map(a => ({...CONST.GENESIS_ADDR_CONTRACT_MAP[a], address: a}))
        contracts = [...INTERNAL, ...GENESIS]
    } else{
        contracts = Object.keys(CONST.INTERNAL_NAME_CONTRACT_MAP)
            .map(n => ({...CONST.INTERNAL_NAME_CONTRACT_MAP[n], name: n})).filter((item: any) => item.space === 'evm')
    }

    for (const c of contracts) {
        const base32 = format.address(c.address, StatApp.networkId)
        const hex40id = (await makeId(c.address)).id
        const contract = {
            epoch: 0,
            base32,
            hex40id
        } as Contract

        c.name && (contract.name = c.name)
        let sourceCode
        if(c.address.startsWith('0x08') || c.address.startsWith('0x1820')) {
            sourceCode = fs.readFileSync(`../../../contracts/${c.name}.sol`)
            sourceCode = sourceCode.toString().trim()
        }
        sourceCode && (contract.sourceCode = sourceCode)
        c.abi && (contract.abi = c.abi)
        c.website && (contract.website = c.website)

        await Contract.upsert(contract)
    }
}

/**
 * migrate verify info
 */
async function verifyBySourcify() {
    const error = `${path.dirname(__filename)}/verif.error`
    while(true) {
        const list = await VerifiedContracts.findAll({
            attributes: ['id','address', 'name', 'version'],
            where: {
                id: {[Op.gt]: lastId},
            },
            offset: 0,
            limit: 1000,
            order: [['id', 'ASC']],
            logging: sql => console.log(sql)
        })

        const size = list?.length
        if(!size) {
            return
        }

        for (let i = 0; i < size; i++) {
            const c = await VerifiedContracts.findOne({
                where: {
                    id: list[i].id
                }
            })

            const input: VerifyInput = {
                contractAddress: ethers.utils.getAddress(format.hexAddress(c.address)),
                sourceCode: c.sourceCode,
                codeFormat: c.language,
                fullQualifiedName: c.name,
                compilerVersion: c.version,
                optimizationUsed: c.optimization ? 1 : 0,
                runs: c.optimization ? c.runs : 200,
                constructorArguments: c.constructorArgs,
                evmVersion: c.evmVersion,
                licenseType: 3,
            }
            if(input.codeFormat === 'solidity-single-file' && c.libraries != '{}') {
                let index = 1
                const libObj = JSON.parse(c.libraries)
                try{
                    Object.keys(libObj).forEach(key => {
                        input[`libraryName${index}`] = key
                        input[`libraryAddress${index++}`] = ethers.utils.getAddress(format.hexAddress(libObj[key]))
                    })
                }catch (e) {
                    console.log('build libs error', {
                        base32: c.address,
                        libraries: c.libraries,
                        address: input.contractAddress,
                        errors: e.message
                    })
                    return
                }
            }
            const  {verificationId} = await contractQuery.verify(input)

            let alreadyVerified
            let notDeployed
            let errOccurs
            while(true){
                const job: VerificationJob = await contractQuery.checkVerification(verificationId)
                // not completed
                if(!job.isJobCompleted) {
                    await sleep(5000)
                    continue
                }
                // verify err
                if(job?.error) {
                    const e = job.error
                    // do not process
                    if(e?.customCode === 'already_verified') {
                        alreadyVerified = true
                        break
                    }
                    // do not process
                    if(e?.customCode === 'contract_not_deployed') {
                        notDeployed = true
                        break
                    }
                    // write contract info to file
                    fs.appendFileSync(error, `${c.address}, ${format.hexAddress(c.address)}, ${c.id}`)
                    console.log('verify error written to file', {
                        base32: c.address,
                        address: input.contractAddress,
                        errors: [e?.message ? `${e.customCode}:${e.message}` : `${e.customCode}`]
                    })
                    errOccurs = true
                    break
                }
                // complete verification
                break
            }
            console.log('verified ==\n', {
                id: c.id,
                base32: c.address,
                hex: format.hexAddress(c.address),
                name: c.name,
                alreadyVerified,
                notDeployed,
                errOccurs
            })

            lastId = c.id
            await sleep(1000)
        }
    }
}

const GIT_PATH_COMPILER = 'https://github.com/vyperlang/vyper/releases/download'
async function fetchCompilers() {
    const versions = await contractQuery.listVyperVersions()

    const commands = Object.keys(versions)
        .map(ver => `proxychains4 curl -O -L "${GIT_PATH_COMPILER}/v${ver}/vyper.${ver}+commit.${versions[ver].commit}.linux"`)
    console.log(`Cmd to exec: ${commands.length}`);

    const { suc, fai } = executeCommands(commands);
    console.log('\nExec Summary:\n', {suc, fai})
}

function executeCommands(commands) {
    let suc = 0;
    let fai = 0;

    commands.forEach((cmd, index) => {
        console.log(`Executing command ${index + 1}/${commands.length}: ${cmd}`);
        try {
            execSync(cmd, { stdio: 'inherit' });
            console.log(`Command ${index + 1} succeeded`);
            suc++;
        } catch (error) {
            console.error(`Command ${index + 1} failed: ${error.message}`);
            fai++;
        }
    });

    return { suc, fai };
}

async function missingVerified() {
    const axios = require('axios');
    const missing = `${path.dirname(__filename)}/verify.missing`

    while(true) {
        const list = await VerifiedContracts.findAll({
            attributes: ['id','address', 'name'],
            where: {id: {[Op.gt]: lastId},}, offset: 0, limit: 1000, order: [['id', 'ASC']],
        })

        const size = list?.length
        if(!size) {
            return
        }

        console.log(`start to process ${size} contracts ${list[0].id} ${list[size-1].id}...`)
        for (let i = 0; i < size; i++) {
            const {id, address, name} = list[i]

            const contract = StatApp.isEVM ?
                ethers.utils.getAddress(format.hexAddress(address)) : format.address(address, StatApp.networkId)
            const apiUrl = `${url}address=${contract}`

            let resp
            do{
                try{
                    resp = await axios.get(apiUrl, {family: 4, headers: {'Accept': 'application/json'}})
                }catch (e) {
                    console.log(`http err ${apiUrl}`, e)
                }
                if(resp?.status === 200) {
                    break
                }
                await sleep(1000)
                console.log('retry...', {httpStatus: resp?.status, message: resp?.body?.message})
            } while(true)

            const {data: {status, code}} = resp
            if(status === "0" || code === 1) {
                fs.appendFileSync(missing, `${contract}, ${name}\n`)
                console.log('missing verified', {contract, name, url: apiUrl})
            }

            lastId = id
            if(i % 100 === 0) {
                await sleep(3000)
            }
        }
    }
}
