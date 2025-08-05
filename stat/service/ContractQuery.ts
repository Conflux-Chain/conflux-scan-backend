import {toBase32} from "./tool/AddressTool";
import {
    Hex40Map,
    hex40IdMap,
    POCKET_ADDRESS_MAP,
    ESpaceHex40Map, getAddrId,
} from "../model/HexMap";
import {Op, QueryTypes} from "sequelize";
import {fmtAddr, StatApp} from "../StatApp";
import {Desensitizer} from "./Desensitizer";
import {ContractDestroy, TraceCreateContract} from "../model/TraceCreateContract";
import {ProxyVerify} from "../model/Contract";
import {Errors} from "./common/LogicError";
import {CONST} from "./common/constant"
import {ScanApp, ScanCtx} from "../../scan-api/service/index";
import {SolidityJsonInput, VyperJsonInput} from "@ethereum-sourcify/compilers-types";
import {
    checkPresent,
    checkCodeFormat,
    checkSolcVersion,
    checkVyperVersion,
    checkLibrary,
    checkEVMVersion,
    checkLicense,
    decodeBase64Type250,
    splitFullyQualifiedName, checkSolcOptimization, checkVyperOptimization, convertVyperVersion, checkFullQualifiedName
} from "./common/utils";
import {ContractVerify} from "../model/ContractVerify";
import {ethers} from "ethers";
import {saveAbiInfo} from "../model/ContractInfo";
import {sleep} from "./tool/ProcessTool";

const path = require('path');
const superagent = require('superagent');
const { format, sign } = require('js-conflux-sdk');
const lodash = require('lodash');
const {Contract} = require("../model/Contract");
const abi = require('./tool/abi');

const NodeCache = require( "node-cache" );
const DEFAULT_VERIFY_CACHE_TTL: number = 60 * 60 * 24 * 7 //7days
let _instance: ContractQuery;

export function getContractQuery() {
    return _instance;
}

export class ContractQuery {
    public app: ScanApp;
    private readonly cacheTtl: number
    private CACHE_VERIFY_ADDRESS: any // hex => true
    private CACHE_VERIFY_DETAIL: any  // hex => {}: Contract

    constructor(app: ScanApp, verifyCacheTTL?: number) {
        this.app = app;
        this.cacheTtl = verifyCacheTTL || DEFAULT_VERIFY_CACHE_TTL
        this.CACHE_VERIFY_ADDRESS = new NodeCache({ maxKeys: 5000,  stdTTL: this.cacheTtl, checkperiod: 60})
        this.CACHE_VERIFY_DETAIL = new NodeCache({ maxKeys: 1000,  stdTTL: this.cacheTtl, checkperiod: 60})
        _instance = this;
        this.listSolcVersions().then()
        this.listVyperVersions().then()
    }

    public async count({name}) {
        return Contract.count({where: {name}});
    }

    public async query(address) {
        const list = await this.list([address])
        return list?.length ? list[0] : {}
    }

    public async list(addressArray) {
        if(!addressArray){
            return []
        }

        const addresses = addressArray.map(item => toBase32(item))
        const list = await Contract.findAll({
            attributes: [
                'hex40id',
                ['base32', 'address'],
                'name',
                'website'
            ],
            where: {base32: {[Op.in]: addresses}},
            raw: true
        })

        list?.forEach(item => {
            item.name = Desensitizer.mosaicStr(item.address, item.name)
        })

        return list
    }

    public async queryVerify(address, withDetail = false) {
        address = format.hexAddress(address)
        /*const cache = withDetail ? this.CACHE_VERIFY_DETAIL.get(address) : this.CACHE_VERIFY_ADDRESS.get(address)
        if(cache) {
            return withDetail ? cache : {address: format.address(address, StatApp.networkId)}
        }*/

        // verified info
        let verified: any
        if(this.isInternalContract(address)) {
            verified = await Contract.findOne({
                attributes: [['base32', 'address'], 'sourceCode', 'name', 'abi'],
                where: {base32: format.address(address, StatApp.networkId)},
                raw: true
            })
            verified = this.getInternalVerification(verified)
        } else{
            verified = await this.getVerifyBySourcify(address, withDetail)
            verified = verified || (await this.getVerifyByDB(address, withDetail))
        }
        if(!verified) {
            return verified
        }
        if(!withDetail) {
            /*this.CACHE_VERIFY_ADDRESS.set(address, true, this.cacheTtl)*/
            return verified
        }

        // real-time impl info
        const proxyInfo = await this.queryImplementation(address)
            .catch((e) => {
                console.log('queryVerify error ', e)
            });
        if(proxyInfo?.implementation){
            verified.beacon = proxyInfo.beacon;
            verified.implementation = proxyInfo.implementation;
            verified.proxy = true
            verified.proxyPattern = proxyInfo.proxyPattern;
        }

        // extra info
        if(verified?.beacon){
            let verifiedInfo: any = await this.getVerifyBySourcify(verified.beacon)
            verifiedInfo = verifiedInfo || (await this.getVerifyByDB(address))
            verified.beaconVerified = !!verifiedInfo
        }
        if(verified?.implementation){
            let verifiedInfo: any = await this.getVerifyBySourcify(verified.implementation)
            verifiedInfo = verifiedInfo || (await this.getVerifyByDB(address))
            verified.implementationVerified = !!verifiedInfo
        }
        if(verified?.libraries){
            const libs = [];
            if(typeof verified.libraries === 'string') {
                verified.libraries = JSON.parse(verified.libraries)
            }
            lodash.forIn(verified.libraries, (lib, libKey) =>{
                if(typeof lib === 'object'){
                    Object.keys(lib).forEach(libName => {
                        libs.push({
                            name: `${libKey}:${libName}`,
                            address: format.address(lib[libName], StatApp.networkId)
                        });
                    })
                } else{
                    libs.push({
                        name: libKey,
                        address: lib
                    });
                }
            });
            const verifyMap = {};
            const verifyArray = await this.listVerify(libs.map(item => item.address))
            verifyArray?.forEach((item: any) => verifyMap[item.address] = true);
            libs.forEach(item => ( item['exactMatch'] = !!verifyMap[item.address]));
            verified.libraries = libs;
        } else{
            verified.libraries = {};
        }

        /*this.CACHE_VERIFY_DETAIL.set(address, verified, this.cacheTtl)*/

        return verified;
    }

    private MAX_CONTRACTS = 100

    public async listVerify(addressArray) {
        if(!addressArray){
            return []
        }
        if (!lodash.isArray(addressArray)) {
            addressArray = [addressArray]
        }
        if(addressArray?.length > this.MAX_CONTRACTS) {
            throw Error(`Contract addresses up to ${this.MAX_CONTRACTS} at a time`)
        }
        addressArray = addressArray.map(format.hexAddress)

        let internals = []
        let contractAddresses = []
        addressArray.forEach(address => {
            if(this.isInternalContract(address)) {
                internals.push(address)
            } else{
                contractAddresses.push(address)
            }
        })

        let contracts: string[] = []
        if(contractAddresses.length) {
            const cache = contractAddresses.filter(a => this.CACHE_VERIFY_ADDRESS.get(a))
            if(cache.length === contractAddresses.length) {
                contracts = cache
            } else{
                const results = await this.listVerifyBySourcify(contractAddresses)
                contracts = results.map((r: any) => format.hexAddress(r.address))
                if(results?.length < contractAddresses.length) {
                    const results: any[] = await this.listVerifyByDB(contractAddresses.filter(c => !contracts.includes(c)))
                    const founded = results.map(r => format.hexAddress(r.address))
                    contracts = [...contracts, ...founded]
                }
                contracts.forEach(a => this.CACHE_VERIFY_ADDRESS.set(a, true, this.cacheTtl))
            }
        }

        return [...internals, ...contracts].map(a => ({address: format.address(a, StatApp.networkId)}))
    }

    private isInternalContract(address) {
        return lodash.includes(CONST.INTERNAL_CONTRACT_ALL, format.hexAddress(address))
    }

    private getInternalVerification(verified: {
        address: string,
        sourceCode: string
        name: string,
        abi?: string,
    }){
        const hex = format.hexAddress(verified.address)
        return lodash.assign(verified, {
            version: CONST.INTERNAL_ADDR_CONTRACT_MAP[hex].compilerVersion,
            evmVersion: null,
            optimization: CONST.INTERNAL_ADDR_CONTRACT_MAP[hex].optimization,
            runs: CONST.INTERNAL_ADDR_CONTRACT_MAP[hex].runs,
            license: 'MIT',
            constructorArgs: null,
        })
    }

    private async getVerifyBySourcify(contractAddress, withDetail = false) {
        const hex = ethers.utils.getAddress(format.hexAddress(contractAddress))
        const cache = withDetail ? this.CACHE_VERIFY_DETAIL.get(hex) : this.CACHE_VERIFY_ADDRESS.get(hex)
        if(cache) {
            return withDetail ? cache : {address: format.address(hex, StatApp.networkId)}
        }

        const fields = withDetail ? '?fields=stdJsonInput,compilation,abi' : ''
        const resp = await this._getJsonRequest({
                url: `${this.app.config.contractVerificationUrl}/contract/${StatApp.networkId}/${hex}${fields}`
            })
        if(!resp) {
            return null
        }

        const {address, match, abi, compilation, stdJsonInput, licenseType, contractLabel} = resp.data
        if(match !== 'match') {
            return null
        }

        if(!withDetail) {
            this.CACHE_VERIFY_ADDRESS.set(hex, true, this.cacheTtl)
            return {address: format.address(address, StatApp.networkId)}
        }

        let {
            language,
            compilerVersion,
            compilerSettings,
            fullyQualifiedName,
        } = compilation

        for (const [key, value] of Object.entries(stdJsonInput.sources)) {
            stdJsonInput.sources[key].content = decodeBase64Type250((value as any).content)
        }
        let sourceCode
        if(fullyQualifiedName.startsWith(':')) {
            fullyQualifiedName = fullyQualifiedName.substring(1)
            sourceCode = stdJsonInput.sources[''].content
        } else{
            sourceCode = JSON.stringify(stdJsonInput)
        }

        if(language === 'vyper') {
            compilerVersion = convertVyperVersion(compilerVersion, this.VYPER_VERSIONS)
            fullyQualifiedName = contractLabel
            console.log(`debug vyper compilerSettings.optimize`, JSON.stringify(compilerSettings))
        }

        const verified = {
            address: format.address(address, StatApp.networkId),
            language,
            sourceCode,
            name: fullyQualifiedName,
            abi: abi,
            version: compilerVersion,
            evmVersion: compilerSettings?.evmVersion,
            optimization: language === 'vyper' ? 'N/A' : compilerSettings?.optimizer?.enabled,
            runs: compilerSettings?.optimizer?.runs,
            libraries: compilerSettings?.libraries,
            license: CONST.CONTRACT_LICENSE[licenseType || 1].code,
            constructorArgs: '',
        }
        this.saveABI(address, abi).then()
        this.CACHE_VERIFY_DETAIL.set(hex, verified, this.cacheTtl)
        return verified
    }

    private async listVerifyBySourcify(contractAddresses) {
        const commaSeparatedAddresses = contractAddresses.map(a => ethers.utils.getAddress(format.hexAddress(a))).join(',')

        const resp = await this._getJsonRequest({
            url: `${this.app.config.contractVerificationUrl}/contracts/${StatApp.networkId}?addresses=${commaSeparatedAddresses}`
        })
        if(!resp) {
            return []
        }

        const {results} = resp.data
        return results
    }

    private async getVerifyByDB(contractAddress, withDetail = false) {
        let attributes: any = [['base32', 'address']]
        if(withDetail) {
            attributes = [['base32', 'address'], ['compiler', 'language'], 'sourceCode', 'name', 'abi', 'version', 'evmVersion',
                ['optimizeFlag','optimization'], ['optimizeRuns','runs'], 'libraries', 'license', 'constructorArgs']
        }
        return ContractVerify.findOne({
            attributes,
            where: {base32: format.address(contractAddress, StatApp.networkId), verifyResult: true},
            raw: true
        }).then((verify: any) => {
            if(verify?.language?.substring(0, 8) === 'solidity') {
                verify.language = 'solidity'
            }
            return verify
        })
    }

    private async listVerifyByDB(contractAddresses) {
        contractAddresses = contractAddresses.map(a => format.address(a, StatApp.networkId))
        return ContractVerify.findAll({
            attributes: [
                ['base32', 'address'],
            ],
            where: {
                verifyResult: true,
                base32: {[Op.in]: contractAddresses},
            },
            order: [['id', 'DESC']],
            raw: true,
        })
    }

    public async listBasic({ addressArray = []}: {
        addressArray?: string[]
    }) {
        const {
            app: { tokenQuery, service },
        } = this as ScanCtx;

        // remove repeat
        const networkId = StatApp.networkId;
        addressArray = [...new Set(addressArray.filter(Boolean).map(address => format.hexAddress(address)))];
        if (addressArray.length === 0) { return { total: 0, map: {} };}

        const hexIdMap = await hex40IdMap(addressArray);
        const traceCreates = await TraceCreateContract.findAll({where: {to: {[Op.in]: [...hexIdMap.values()]}}});
        const registeredContracts = await Contract.findAll({where: {hex40id: {[Op.in]: [...hexIdMap.values()]}}});
        const hexIdArray = [...new Set([...traceCreates.map(item => item.to), ...registeredContracts.map(item => item.hex40id)])];

        const eSpaceHex40Array = await ESpaceHex40Map.findAll({where: {hexId: {[Op.in]: [...hexIdMap.values()]}}});
        const eSpaceBase32Hex40Map = {};
        if(eSpaceHex40Array?.length){
            for(const item of eSpaceHex40Array){
                eSpaceBase32Hex40Map[`0x${item.hex}`] = `0x${item.hex}`;
            }
        }

        if (hexIdArray.length === 0) {
            const map = {};
            Object.keys(eSpaceBase32Hex40Map).forEach((address) => {
                map[address] = {eSpace: {address: eSpaceBase32Hex40Map[address]}}
            });
            const total = Object.keys(map)?.length;
            return { total, map };
        }

        const idHexMap = {};
        hexIdMap.forEach((hexId,hex) => (idHexMap[hexId] = hex));
        addressArray = [];
        hexIdArray.forEach(hexId => addressArray.push(`0x${idHexMap[hexId]}`));
        addressArray = addressArray.map(address => format.address(address, networkId));

        // init
        const map = {};
        addressArray.forEach((address) => { map[address] = {contract: {address}, token: {address}}; });

        // query contract and token
        const tokenService = tokenQuery || service.tokenRdb;
        const [ contractArray, verifiedArray, tokenArray ] = await Promise.all([
            this.list(addressArray).then(list => list.map(contract => {
                return { address: contract.address, name: contract.name }})),
            this.listVerify(addressArray).then(response => response.map(verified => verified.address)),
            tokenService.list({addressArray}).then(response => response.list),
        ]);

        // build response
        contractArray.forEach((contract) => {
            map[contract.address].contract = lodash.defaults(map[contract.address].contract, {
                name: contract.name,
                isVirtual: POCKET_ADDRESS_MAP[contract.name] == format.hexAddress(contract.address),
                // v1: POCKET_ADDRESS_MAP[contract.name], v2: format.hexAddress(contract.address),
                verify: { result: lodash.includes(verifiedArray, contract.address) ? 1 : 0 },
            });
        });
        verifiedArray.forEach((verifiedAddress) => {
            map[verifiedAddress].contract = lodash.defaults(map[verifiedAddress].contract, {
                verify: { result: 1 },
            });
        });
        tokenArray.forEach((token) => {
            map[token.address].token = lodash.defaults(map[token.address].token, {
                name: token.name,
                symbol: token.symbol,
                decimals: token.decimals,
                icon: token.icon,
                iconUrl: token.iconUrl,
                website: token.website,
                tokenType: token.transferType,
            });
        });
        Object.keys(eSpaceBase32Hex40Map).forEach((address) => {
            if(!map[address]) map[address] = {};
            map[address].eSpace = {address: eSpaceBase32Hex40Map[address]};
        });

        if (StatApp.isEVM) {
            Object.keys(map).forEach(base32=>{
                const obj = map[base32];
                // delete map[base32]; // do not delete, keep both, others may query map by base32.
                const hex = fmtAddr(base32, StatApp.networkId);
                map[hex] = obj;
                Object.keys(obj).forEach(k=>{
                    obj[k].address = hex;
                })
            })
        }

        return {total: addressArray.length, map};
    }

    public async queryImplementation(contractAddress) {
        const {cfx} = this.app
        const base32 = format.address(contractAddress, StatApp.networkId)
        let result = {proxy: false}
        const implementation = await Promise.all([
            CONST.POSITION_IMPLEMENTATION_SLOT,
            CONST.IMPLEMENTATION_SLOT_OZ,
            CONST.IMPLEMENTATION_SLOT_EIP1822,
        ].map(slot=>{
            return cfx.getStorageAt(base32, slot).then(res=>{
                return res
            })
        })).then(arr=>arr.find(implementation=>
            implementation !== null && implementation !== CONST.ZERO_VALUE_IN_SLOT
        ))

        const [beacon] = await Promise.all([
            cfx.getStorageAt(base32, CONST.POSITION_BEACON_SLOT)
        ])

        let beaconHex40
        let implHex40
        if (implementation) {
            implHex40 = implementation.substr(26)
        }
        if (beacon !== null && beacon !== CONST.ZERO_VALUE_IN_SLOT) {
            beaconHex40 = `0x${beacon.substr(26)}`;
            const contract = cfx.Contract({abi});
            const impl = await contract.implementation()
            .call({to: beaconHex40}, undefined)
            .catch(() => undefined)
            implHex40 = format.hexAddress(impl).substr(2)
        }
        if (!implHex40) return result

        const hex40 = await Hex40Map.findOne({where: {hex: implHex40}, raw: true})
        if (!hex40) return result

        const beaconAddress = beaconHex40 ? fmtAddr(beaconHex40, StatApp.networkId) : null
        const implAddress = fmtAddr(`0x${hex40.hex}`, StatApp.networkId)
        return lodash.assign(result, {
            proxy: true,
            beacon: beaconAddress,
            implementation: implAddress,
            proxyPattern: "OpenZeppelin's Unstructured Storage"
        })
    }

    public async queryDestroyInfo(address) {
        const {cfx, } = this.app;
        const hex = format.hexAddress(address);

        if(lodash.includes(CONST.INTERNAL_CONTRACT, hex)){
            return CONST.DEPLOY_STATUS.DEPLOYED;
        }
        const {codeHash} = await cfx.getAccount(hex);
        if(codeHash !== CONST.CODEHASH_NO_BYTECODE){
            return CONST.DEPLOY_STATUS.DEPLOYED;
        }

        const hex40Bean = await Hex40Map.findOne({where: {hex: hex.substr(2)}});
        if(hex40Bean === null){
            return CONST.DEPLOY_STATUS.NOT_DEPLOYED;
        }
        const trace = await TraceCreateContract.findOne({where: {to: hex40Bean.id}});
        if(trace === null){
            return CONST.DEPLOY_STATUS.NOT_DEPLOYED;
        }

        const adminDestroy = await ContractDestroy.findOne({where: {contract: hex.substr(2)}});
        if(adminDestroy !== null){
            return CONST.DEPLOY_STATUS.ADMIN_DESTROYED;
        }

        return CONST.DEPLOY_STATUS.SELF_DESTRUCTED;
    }

    public async submitVerifyProxy({ address, expectedImpl }) {
        const base32 = toBase32(address);
        expectedImpl = !expectedImpl ? null : toBase32(expectedImpl);

        const verify = await ProxyVerify.findOne({where: {base32, expectedImpl}, useMaster: true});
        if(verify) {
            return {address, guid: verify.guid};
        }

        const guid = this.genGUID(base32);
        const record = await ProxyVerify.add({base32, expectedImpl, guid} as ProxyVerify);
        console.log(`[${address}]stat submitVerifyProxy request`, 'addResult ', `${JSON.stringify(record)}`);
        return { address, guid: record.guid };
    }

    public async checkVerifyProxy({ guid }) {
        const record = await ProxyVerify.findOne({where: {guid}, raw: true});
        if(!record) {
            throw new Errors.ParameterError(`guid ${guid} not exist`);
        }

        const implInfo =  await this.queryImplementation(record.base32);
        return lodash.assign(lodash.pick(record, ['guid', 'base32', 'expectedImpl']),
            lodash.pick(implInfo, ['proxy', 'implementation']));
    }

    private genGUID(base32){
        const plain = `${base32}${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const random = sign.keccak256(Buffer.from(plain)).toString('hex');
        return random.substr(0, 50);
    }

    private SOLC_VERSIONS
    private SOLC_VERSIONS_UPDATE_TIME
    private readonly SOLC_VERSIONS_UPDATE_INTERVAL = 1000 * 60 * 10 // update every 10 minutes
    async listSolcVersions(): Promise<{[shortVersion: string]: string}> {
        if(!this.SOLC_VERSIONS || Date.now() - this.SOLC_VERSIONS_UPDATE_TIME >= this.SOLC_VERSIONS_UPDATE_INTERVAL ) {
            const resp = await this._getJsonRequest({
                url: 'https://solc-bin.ethereum.org/bin/list.json'
            })
            if(!resp) {
                return
            }
            const {data} = resp
            this.SOLC_VERSIONS = lodash.mapValues(data.releases, solcName => solcName.substring(8, solcName.length - 3))
            this.SOLC_VERSIONS_UPDATE_TIME = Date.now()
        }

        return this.SOLC_VERSIONS
    }

    private VYPER_VERSIONS
    private VYPER_VERSIONS_UPDATE_TIME
    private readonly VYPER_VERSIONS_UPDATE_INTERVAL = 1000 * 60 * 10 // update every 10 minutes
    async listVyperVersions(): Promise<{[shortVersion: string]: {desc: string, commit: string}}> {
        if(!this.VYPER_VERSIONS || Date.now() - this.VYPER_VERSIONS_UPDATE_TIME >= this.VYPER_VERSIONS_UPDATE_INTERVAL ) {
            const versions = {}
            let page = 1

            while (true) {
                let resp
                try{
                    resp = await this._getJsonRequest({
                        url: `https://api.github.com/repos/vyperlang/vyper/tags?page=${page}&per_page=100`,
                        headers: {
                            'User-Agent': 'Vyper-Version-Checker'
                        }
                    })
                    if(!resp) {
                        continue
                    }
                }catch (e){
                    if (e.code === 403 || e.code === 429) {
                        return null
                    }
                    throw e
                }

                const {data: list} = resp
                if (!list?.length) {
                    break
                } else {
                    list.filter(v => v.name.startsWith('v')).forEach(v => {
                        const ver = v.name.substring(1)
                        versions[ver] = {
                            desc: `vyper:${ver}`,
                            commit: v.commit.sha.substring(0, 8)
                        }
                    })
                    page++
                }
            }

            this.VYPER_VERSIONS = versions
            this.VYPER_VERSIONS_UPDATE_TIME = Date.now()
        }

        return this.VYPER_VERSIONS
    }

    public async verify(verifyInput: VerifyInput) {
        let {
            contractAddress, sourceCode, codeFormat, fullQualifiedName, compilerVersion, optimizationUsed, runs,
            constructorArguments, evmVersion, licenseType,
            libraryName1, libraryAddress1, libraryName2, libraryAddress2, libraryName3, libraryAddress3,
            libraryName4, libraryAddress4, libraryName5, libraryAddress5, libraryName6, libraryAddress6,
            libraryName7, libraryAddress7, libraryName8, libraryAddress8, libraryName9, libraryAddress9,
            libraryName10, libraryAddress10
        } = verifyInput
        checkPresent({contractAddress, sourceCode, compilerVersion, fullQualifiedName},
            ['contractAddress', 'sourceCode', 'compilerVersion', 'fullQualifiedName'])

        checkCodeFormat(codeFormat)
        let jsonInput, contractPath, contractName, contractLabel
        if(CONST.CONTRACT_CODE_FORMATS_SOLIDITY.includes(codeFormat)) {
            compilerVersion = checkSolcVersion(compilerVersion, this.SOLC_VERSIONS)
            if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.SOLIDITY_STANDARD_JSON_INPUT.code){
                jsonInput = JSON.parse(sourceCode);
                optimizationUsed = jsonInput.settings.optimizer.enabled;
                runs = jsonInput.settings.optimizer.runs;
            }
            const optimize = checkSolcOptimization(optimizationUsed, runs)
            optimizationUsed = optimize.optimizationUsed
            runs = optimize.runs
            const fqn = splitFullyQualifiedName(fullQualifiedName)
            contractPath = fqn.contractPath
            contractName = fqn.contractName
            contractLabel = ''
        } else {
            compilerVersion = checkVyperVersion(compilerVersion, this.VYPER_VERSIONS)
            if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.VYPER_JSON.code) {
                jsonInput = JSON.parse(sourceCode);
                optimizationUsed = jsonInput.settings.optimize
            }
            optimizationUsed = checkVyperOptimization(optimizationUsed)
            const fqn = splitFullyQualifiedName(fullQualifiedName)
            if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.VYPER_SINGLE_FILE.code) {
                contractPath = "."
                contractName = ""
            } else{
                contractPath = fqn.contractPath
                contractName = path.parse(fqn.contractPath).name
            }
            contractLabel = fqn.contractName || 'Vyper_contract'
        }
        const librariesInfo = {
            library1: {name: libraryName1, address: libraryAddress1},
            library2: {name: libraryName2, address: libraryAddress2},
            library3: {name: libraryName3, address: libraryAddress3},
            library4: {name: libraryName4, address: libraryAddress4},
            library5: {name: libraryName5, address: libraryAddress5},
            library6: {name: libraryName6, address: libraryAddress6},
            library7: {name: libraryName7, address: libraryAddress7},
            library8: {name: libraryName8, address: libraryAddress8},
            library9: {name: libraryName9, address: libraryAddress9},
            library10: {name: libraryName10, address: libraryAddress10},
        }
        const libraries = checkLibrary(librariesInfo);
        evmVersion = await checkEVMVersion(evmVersion);
        licenseType = checkLicense(licenseType)

        if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.SOLIDITY_SINGLE_FILE.code) {
            jsonInput = {
                language: "Solidity",
                sources: {
                    [contractPath]: {
                        content: sourceCode,
                    },
                },
                settings: {
                    evmVersion,
                    optimizer: {
                        enabled: !!optimizationUsed,
                        runs,
                    },
                    libraries: Object.keys(libraries).length ? { [contractPath]: libraries } : undefined,
                },
            }
        }
        if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.VYPER_SINGLE_FILE.code) {
            jsonInput = {
                language: "Vyper",
                sources: {
                    [contractPath]: {
                        content: sourceCode,
                    },
                },
                settings: {
                    evmVersion,
                    optimize: optimizationUsed,
                },
            }
        }

        const trace: any = await TraceCreateContract.sequelize.query(
            "select concat('0x',txHash) as txHash from trace_create_contract where `to` = (select id from hex40 where hex=?)",
            {
                type: QueryTypes.SELECT,
                replacements:[contractAddress.substr(2)]
            }).then(traces => {return traces?.length ? traces[0] : undefined})

        const input: VerifyFromJsonInput = {
            chainId: StatApp.networkId,
            address: contractAddress,
            jsonInput,
            compilerVersion: compilerVersion,
            compilationTarget: {
                name: contractName,
                path: contractPath,
            },
            creationTransactionHash: trace?.txHash,
            licenseType,
            contractLabel,
        }
        const verifyResult = await this.verifyFromJsonInput(input)
        this.saveABI(contractAddress).then()
        return verifyResult
    }

    private async verifyFromJsonInput(
        input: VerifyFromJsonInput,
    ): Promise<VerifyResponse | VerifyErrorResponse> {
        const result = await this.postJsonRequest({
            url: `${this.app.config.contractVerificationUrl}/verify/${input.chainId}/${input.address}`,
            body: {
                stdJsonInput: input.jsonInput,
                compilerVersion: input.compilerVersion,
                contractIdentifier: `${input.compilationTarget.path}:${input.compilationTarget.name}`,
                creationTransactionHash: input.creationTransactionHash,
                licenseType: input.licenseType,
                contractLabel: input.contractLabel,
            },
        })

        if(!result) {
            return {
                customCode: 'malformed_verification_response',
                message: 'Business is busy, please try again later'
            }
        }

        return {
            verificationId: result.data.verificationId
        }
    }

    private async saveABI(
        address: string,
        abi?: string,
        interval: number = 1000,
        retries: number = 4,
    ) {
        for (let attempts = 0; attempts < retries; attempts++) {
            if(!abi) {
                const verified = await this.getVerifyBySourcify(address, true).catch()
                abi = verified?.abi
            }
            if(abi) {
                const hexId = await getAddrId(address)
                saveAbiInfo(abi, hexId).catch(e => {
                    console.log(`saveAbiInfo ${address}`, e)
                })
                break
            }
            await sleep(interval)
            interval *= 2
        }
    }

    public async checkVerification(
        verificationId: string
    ): Promise<VerificationJob> {
        const result = await this._getJsonRequest({
            url: `${this.app.config.contractVerificationUrl}/verify/${verificationId}`,
        });
        if(!result) {
            return {
                verificationId,
                isJobCompleted: false,
            } as VerificationJob
        }

        return result.data as VerificationJob
    }

    private async postJsonRequest(
        {
            url,
            body,
            headers = {},
            timeout = 1000 * 30
        }) {
        try {
            const response = await superagent
                .post(url)
                .set({
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...headers
                })
                .timeout(timeout)
                .send(body);
            return {
                status: response.status,
                data: response.body,
                headers: response.headers
            };
        } catch (error) {
            const err = new Error(error.message || 'HTTP request failed');
            err['code'] = error.status;
            err['stack'] = error.stack;
            if(err['code'] === 404 || err['code'] === undefined) {
                return null
            }
            throw err;
        }
    }

    private async _getJsonRequest(
        {
            url,
            headers = {},
            timeout = 1000 * 30
        }) {
        try {
            const response = await superagent
                .get(url)
                .set({
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...headers
                })
                .timeout(timeout);
            return {
                status: response.status,
                data: response.body,
                headers: response.headers
            };
        } catch (error) {
            const err = new Error(error.message || 'HTTP request failed');
            err['code'] = error.status;
            err['stack'] = error.stack;
            if(err['code'] === 404 || err['code'] === undefined) {
                return null
            }
            throw err;
        }
    }
}

export interface VerifyInput {
    contractAddress: string;
    sourceCode: string;
    codeFormat: string;
    fullQualifiedName: string;
    compilerVersion: string;
    optimizationUsed?: number;
    runs?: number;
    constructorArguments?: string;
    evmVersion?: string;
    licenseType?: number;
    libraryName1?: string;
    libraryAddress1?: string;
    libraryName2?: string;
    libraryAddress2?: string;
    libraryName3?: string;
    libraryAddress3?: string;
    libraryName4?: string;
    libraryAddress4?: string;
    libraryName5?: string;
    libraryAddress5?: string;
    libraryName6?: string;
    libraryAddress6?: string;
    libraryName7?: string;
    libraryAddress7?: string;
    libraryName8?: string;
    libraryAddress8?: string;
    libraryName9?: string;
    libraryAddress9?: string;
    libraryName10?: string;
    libraryAddress10?: string;
}

export interface VerifyFromJsonInput {
    chainId: number;
    address: string;
    jsonInput: SolidityJsonInput | VyperJsonInput;
    compilerVersion: string;
    compilationTarget: CompilationTarget;
    creationTransactionHash?: string;
    licenseType: number;
    contractLabel: string;
}

export interface CompilationTarget {
    name: string;
    path: string;
}

export interface VerifyResponse {
    verificationId: string;
}

export interface VerifyErrorResponse {
    customCode: string;
    message: string;
}

export interface VerificationJob {
    isJobCompleted: boolean;
    verificationId: string;
    jobStartTime: string;
    jobFinishTime?: string;
    compilationTime?: number;
    error?: VerifyErrorResponse;
    contract: VerifiedContractMinimal;
}

export interface VerifiedContractMinimal {
    match: MatchLevel;
    creationMatch: MatchLevel;
    runtimeMatch: MatchLevel;
    chainId: number;
    address: string;
    verifiedAt?: string;
    matchId?: string;
}

export type MatchLevel = "match" | "exact_match" | null;
