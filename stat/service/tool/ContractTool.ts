import {Hex40Map, makeId} from "../../model/HexMap";
import {init as initialize} from "./FixDailyTokenStat";
import {StatApp} from "../../StatApp";
import {StatConfig} from "../../config/StatConfig";
import {initCfxSdk} from "../common/utils";
import {CONST} from "../common/constant";
import {ContractQuery, VerificationJob, VerifyInput} from "../ContractQuery";
import {IS_EVM2, KV} from "../../model/KV";
import {ContractVerify} from "../../model/ContractVerify";
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
let lastContractId = 0
if(type === 2) {
    lastContractId = Number(args[2])
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
    let lastID = lastContractId
    const verifyErrContractInfoFile = `${path.dirname(__filename)}/verif.err`
    while(true) {
        const list = await ContractVerify.findAll({
            attributes: ['id','base32', 'name', 'version'],
            where: {
                id: {[Op.gt]: lastID},
                verifyResult: true,
                [Op.or]: [
                    {proxyPattern: null},
                    {proxyPattern: {[Op.ne]: 'Minimal Proxy Contract'}},
                ]
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
            const c = await ContractVerify.findOne({
                where: {
                    id: list[i].id
                }
            })

            const input: VerifyInput = {
                contractAddress: ethers.utils.getAddress(format.hexAddress(c.base32)),
                sourceCode: c.sourceCode,
                codeFormat: c.compiler,
                fullQualifiedName: c.name,
                compilerVersion: c.version,
                optimizationUsed: c.optimizeFlag ? 1 : 0,
                runs: c.optimizeFlag ? c.optimizeRuns : 200,
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
                        base32: c.base32,
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
                    fs.writeFileSync(verifyErrContractInfoFile, `${c.base32}, ${format.hexAddress(c.base32)}, ${c.id}`)
                    console.log('verify error written to file', {
                        base32: c.base32,
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
                base32: c.base32,
                hex: format.hexAddress(c.base32),
                name: c.name,
                alreadyVerified,
                notDeployed,
                errOccurs
            })

            lastID = c.id
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
