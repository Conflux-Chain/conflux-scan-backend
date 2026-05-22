import {
    Hex40Map,
    getAddrId,
    formatToBase32,
    makeId,
    makeIdV,
} from "../model/HexMap";
import {Op, QueryTypes} from "sequelize";
import {fmtAddr, StatApp} from "../StatApp";
import {Desensitizer} from "./Desensitizer";
import {ContractDestroy, TraceCreateContract} from "../model/TraceCreateContract";
import {ProxyVerify} from "../model/Contract";
import {Errors} from "./common/LogicError";
import {CONST} from "./common/constant"
import {SolidityJsonInput, VyperJsonInput} from "@ethereum-sourcify/compilers-types";
import {
    checkPresent,
    checkCodeFormat,
    checkSolcVersion,
    checkVyperVersion,
    checkLibrary,
    checkEVMVersion,
    checkLicense,
    splitFullyQualifiedName,
    checkSolcOptimization,
    checkVyperOptimization,
    convertVyperVersion
} from "./common/utils";
import {VerifiedContracts} from "../model/VerifiedContracts";
import {ethers} from "ethers";
import {AbiInfo, saveAbiInfo} from "../model/ContractInfo";
import {sleep} from "./tool/ProcessTool";
import {
    KEY_AUTO_VERIFY_TRACE_ID,
    KEY_AUTO_VERIFY_VERIFY_ID,
    KEY_EVM_VERSIONS,
    KEY_SOLC_VERSIONS,
    KEY_VYPER_VERSIONS,
    VERIFIED_COUNT_ALL,
    KEY_STAT_TXNS_FOR_VERIFIED_CONTRACTS,
    KEY_STAT_ANNOUNCE_NAME_FOR_VERIFIED_CONTRACTS,
    KEY_STAT_NAME_TAG_FOR_VERIFIED_CONTRACTS,
    KEY_SOLC_VULNERABILITIES,
    KV,
} from "../model/KV";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import axios from "axios";
import {doHeartBeat, HeartBeatBean, KEY_COMPILER} from "../model/HeartBeat";
import {ConfigInstance, VerificationOptions} from "../config/StatConfig";
import {Conflux, format, sign} from "js-conflux-sdk";
import {ContractImpl} from "../model/ContractImpl";
import {AddressTransactionIndex, FullBlock, FullTransaction, loadMaxBlockEpoch} from "../model/FullBlock";
import {CfxBalance} from "../model/Balance";
import {PruneInfo, PruneType} from "../model/PruneInfo";
import {ContractTraceCreateQuery} from "./ContractTraceCreateQuery";
import {NameTag} from "../model/NameTag";

const path = require('path');
const superagent = require('superagent');
const lodash = require('lodash');
const {Contract} = require("../model/Contract");
const abi = require('./tool/abi');

const NodeCache = require( "node-cache" );
const DEFAULT_VERIFY_CACHE_TTL: number = 60 * 60 * 24 * 7 // 7 days
const DEFAULT_COMPILER_CACHE_TTL: number = 60 * 3 // 3 min
const ZERO_LABS_PROXY_BEACON_MAP = {
    "0xea224dbb52f57752044c0c86ad50930091f561b9":"0x0e9cc1be1060e3dd036f16977a186a8185acc513",
    "0x712a30816a8756c8fdb78de63db55aa70d3cf3b4":"0x335ae8961fface946c25900aa689d793dc3ff1bf",
    "0x81568b27b210538869f5659035ebf506d2fc3384":"0x335ae8961fface946c25900aa689d793dc3ff1bf",
    "0x8ee1af5b2791c7fa6065a02e4b579a9cc78388fb":"0x335ae8961fface946c25900aa689d793dc3ff1bf",
    "0xcb8fb96dd0f60085c9b0ef4ffaea219caffbf972":"0x335ae8961fface946c25900aa689d793dc3ff1bf"
}
let _instance: ContractQuery;

export function getContractQuery() {
    return _instance;
}

export class ContractQuery {
    static verifyEnable: boolean;
    private cfx: Conflux;
    private traceCreate: ContractTraceCreateQuery;
    private readonly verifyUrl: string;

    private readonly cacheTtl: number
    private CACHE_VERIFY_ADDRESS: any // hex => {address, name}
    private CACHE_VERIFY_DETAIL: any  // hex => Contract
    private readonly cacheCompilerTtl: number
    private CACHE_COMPILER_VERSIONS: any  // solc | vyper => {}

    constructor(
        {cfx, config}: { cfx: Conflux; config: VerificationOptions; },
        verifyCacheTTL?: number,
        compilerCacheTTL?: number
    ) {
        const {enable, url} = config;
        if (enable && !url) {
            throw new Error("Contract service configurations (verification.url) should be provided!");
        }

        this.cfx = cfx;
        this.traceCreate = new ContractTraceCreateQuery(cfx);
        ContractQuery.verifyEnable = enable;
        this.verifyUrl = url;

        this.cacheTtl = verifyCacheTTL || DEFAULT_VERIFY_CACHE_TTL
        this.CACHE_VERIFY_ADDRESS = new NodeCache({maxKeys: 5000, stdTTL: this.cacheTtl, checkperiod: 60})
        this.CACHE_VERIFY_DETAIL = new NodeCache({maxKeys: 1000, stdTTL: this.cacheTtl, checkperiod: 60})
        this.cacheCompilerTtl = compilerCacheTTL || DEFAULT_COMPILER_CACHE_TTL
        this.CACHE_COMPILER_VERSIONS = new NodeCache({maxKeys: 2, stdTTL: this.cacheCompilerTtl, checkperiod: 60})

        this.heartBeat();
        _instance = this;
    }

    public async count({name}) {
        return Contract.count({where: {name}});
    }

    public async query(address) {
        const list = await this.list([address])
        return list?.length ? list[0] : {}
    }

    public async list(addresses: string[]) {
        if(!addresses?.length){
            return [];
        }

        const list = await Contract.findAll({
            attributes: [
                'hex40id',
                ['base32', 'address'],
                'name',
                'website',
            ],
            where: {base32: {[Op.in]: addresses.map(item => formatToBase32(item))}},
            raw: true,
        });

        list.forEach((item: any) => {
            item.name = Desensitizer.mosaicStr(item.address, item.name);
        })

        return list;
    }

    public async queryVerify(address, withDetail = false) {
        address = format.hexAddress(address)

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
        }
        if(!verified) {
            return verified
        }
        if(!withDetail) {
            return verified
        }

        // real-time impl info
        const implInfo = await this.getImpl(address);
        if(implInfo){
            lodash.assign(verified, implInfo, {proxy: true});
        }

        // extra info
        if(verified?.beacon){
            let verifiedInfo: any = await this.getVerifyBySourcify(verified.beacon)
            verified.beaconVerified = !!verifiedInfo
        }
        if(verified?.implementation){
            let verifiedInfo: any = await this.getVerifyBySourcify(verified.implementation)
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

            const verifyArray = await this.listVerifyByAddress(libs.map(item => item.address));
            const verifyMap = Object.fromEntries(verifyArray.map(item => [item.address, true]));

            libs.forEach(item => ( item['exactMatch'] = !!verifyMap[item.address]));
            verified.libraries = libs;
        } else{
            verified.libraries = {};
        }

        return verified;
    }

    private MAX_CONTRACTS = 100;

    public async listVerifyByAddress(addresses: string[]) {
        if (!addresses?.length) {
            return [];
        }

        if (addresses.length > this.MAX_CONTRACTS) {
            throw Error(`Contract addresses up to ${this.MAX_CONTRACTS} at a time`);
        }

        let internals = [];
        let contracts = [];
        addresses.map(format.hexAddress).forEach(address => {
            if (this.isInternalContract(address)) {
                internals.push(address);
            } else {
                contracts.push(address);
            }
        });

        const verified: { address: string, name: string, }[] = [];
        if (contracts.length) {
            const hits = contracts.map(item=>this._getCache(item, false)).filter(Boolean);
            if (hits.length === contracts.length) {
                verified.push(...hits);
            } else {
                verified.push(...(await this.listVerifyByDB(contracts)));

                if (verified.length < contracts.length) {
                    const founded = verified.map(item => format.hexAddress(item.address));
                    const fetched = await this.listVerifyBySourcify(contracts.filter(item => !founded.includes(item)));
                    verified.push(...fetched);
                }

                verified.forEach(item => this._addCache(format.hexAddress(item.address), item));
            }
        }

        return [
            ...internals.map(item => ({
                address: format.address(item, StatApp.networkId),
                name: CONST.INTERNAL_ADDR_CONTRACT_MAP[item].name,
            })),
            ...verified,
        ];
    }

    public async listVerifyByCursor(
        {
            sort = 'DESC',
            cursor = 0,
            limit = 10,
            minTimestamp,
            maxTimestamp,
        }: {
            sort?: string,
            cursor?: number,
            limit?: number,
            minTimestamp?: number,
            maxTimestamp?: number,
    }) {
        const cursorField = "matchId";
        const options: any = {
            order: [[cursorField, sort]],
            limit,
            raw: true,
        };
        const conditions = [];
        if (cursor > 0) {
            conditions.push({[cursorField]: {[sort === 'DESC' ? Op.lt : Op.gt]: cursor}});
        }
        const timeConditions = []
        if (minTimestamp !== undefined) {
            timeConditions.push({verifiedAt: {[Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if (maxTimestamp !== undefined) {
            timeConditions.push({verifiedAt: {[Op.lte]: new Date(maxTimestamp * 1000)}});
        }
        conditions.push(...timeConditions);
        if (conditions.length === 1) {
            options.where = conditions[0];
        }
        if (conditions.length > 1) {
            options.where = {[Op.and]: conditions};
        }

        const result: any = await this.listVerifyByOptions(options, timeConditions);

        result.next = result?.list?.length ? result.list[result.list.length - 1][cursorField] : 0;

        return result;
    }

    public async listVerifyByFilter(
        {
            compiler,
            contractName,
            compilerVersion,
            licenseType,
            contractAddress,
            deployerAddress,
            startEpoch,
            endEpoch,
            minTimestamp,
            maxTimestamp,
            hasNametag,
            sortField = 'verified_time',
            sort = 'DESC',
            skip = 0,
            limit = 10,
        }: {
            compiler?: string,
            contractName?: string,
            compilerVersion?: string,
            licenseType?: number,
            contractAddress?: string,
            deployerAddress?: string,
            startEpoch?: number,
            endEpoch?: number,
            minTimestamp?: number,
            maxTimestamp?: number,
            hasNametag?: string,
            sortField?: string,
            sort?: string,
            skip?: number,
            limit?: number,
        }) {
        if (compilerVersion) {
            if (compilerVersion.startsWith("vyper:")) {
                const vyperVersions = await this.listVyperVersions();
                compilerVersion = checkVyperVersion(compilerVersion, vyperVersions);
            } else {
                const solcVersions = await this.listSolcVersions();
                compilerVersion = checkSolcVersion(compilerVersion, solcVersions);
            }
        }

        if (lodash.isNumber(licenseType)) {
            licenseType = checkLicense(licenseType);
        }

        const options: any = {
            order: [[sortField === 'verified_time' ? 'verifiedAt' : 'txns', sort]],
            offset: skip,
            limit,
            raw: true,
        };
        const conditions = [];
        if (compiler !== undefined) {
            conditions.push({compiler});
        }
        if (contractName !== undefined) {
            conditions.push({name: {[Op.like]: `%${contractName}%`}});
        }
        if (compilerVersion !== undefined) {
            conditions.push({version: compilerVersion});
        }
        if (lodash.isNumber(licenseType)) {
            const license = CONST.CONTRACT_LICENSE[licenseType].code;
            conditions.push({license});
        }
        if (contractAddress !== undefined) {
            conditions.push({address: format.address(contractAddress, StatApp.networkId)});
        }
        if (deployerAddress !== undefined) {
            conditions.push({deployer: ethers.getAddress(deployerAddress)});
        }
        if (startEpoch !== undefined) {
            conditions.push({epoch: {[Op.gte]: startEpoch}});
        }
        if (endEpoch !== undefined) {
            conditions.push({epoch: {[Op.lte]: endEpoch}});
        }
        if (minTimestamp !== undefined) {
            conditions.push({verifiedAt: {[Op.gte]: new Date(minTimestamp * 1000)}});
        }
        if (maxTimestamp !== undefined) {
            conditions.push({verifiedAt: {[Op.lte]: new Date(maxTimestamp * 1000)}});
        }
        if (hasNametag !== undefined) {
            conditions.push({hasNametag: hasNametag === 'true'});
        }
        if (conditions.length === 1) {
            options.where = conditions[0];
        }
        if (conditions.length > 1) {
            options.where = {[Op.and]: conditions};
        }

        return this.listVerifyByOptions(options, conditions);
    }

    private async listVerifyByOptions(options, countConditions) {
        const rows = await VerifiedContracts.findAll(options);

        const solcVulnerabilities = await this.listSolcVulnerabilities();

        const list = rows.map(item => {
            const contractName = splitFullyQualifiedName(item.name).contractName;
            const compilerVersion = item.language === CONST.LANGUAGE.VYPER ?
                item.version : lodash.trimStart(item.version.split("+commit")[0], "v");
            const contract = {
                address: fmtAddr(item.address, StatApp.networkId),
                addressId: item.addressId,
                contractName,
                compiler: item.compiler,
                compilerVersion,
                longCompilerVersion: item.version,
                language: item.language,
                codeFormat: item.codeFormat,
                balance: 0,
                txns: item.txns,
                setting: {
                    optimizationEnabled: item.optimization !== "0" && item.optimization !== "N/A",
                    constructorArgumentsEnabled: item?.constructorArgs?.length > 2,
                },
                license: item.license,
                verifiedAt: item.verifiedAt.getTime() / 1000,
                deployer: fmtAddr(item.deployer, StatApp.networkId),
                [StatApp.isEVM ? "blockNumber" : "epochNumber"]: item.epochNumber,
                hasNametag: Boolean(item.hasNametag),
            };
            if (item.language === CONST.LANGUAGE.SOLIDITY) {
                contract.compilerVulnerabilities = solcVulnerabilities[contract.compilerVersionShort];
            }
            return contract;
        });

        if (!list?.length) {
            const balances = await CfxBalance.findAll({where: {addressId: {[Op.in]: list.map(item => item.addressId)}}});
            list.forEach(item => item.balance = balances[item.addressId]?.total || 0);
        }

        list.forEach(item => delete item.addressId);

        let total;
        if (countConditions.length) {
            total = await VerifiedContracts.count({
                where: countConditions.length === 1 ? countConditions[0] : {[Op.and]: countConditions}
            });
        } else {
            total = await KV.getNumber(VERIFIED_COUNT_ALL, 0);
        }

        return {total, list}
    }

    public async listVerifyInBatch(addresses: string[], chunkSize = this.MAX_CONTRACTS) {
        if(!addresses?.length){
            return [];
        }

        if(addresses.length < this.MAX_CONTRACTS) {
            return this.listVerifyByAddress(addresses);
        }

        const tasks = Array.from(
            { length: Math.ceil(addresses.length / chunkSize) },
            (_, index) => addresses.slice(index * chunkSize, (index + 1) * chunkSize)
        ).map(addresses => this.listVerifyByAddress(addresses));

        const contracts = await Promise.all(tasks);

        return contracts?.flat() || [];
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
            language: CONST.LANGUAGE.SOLIDITY,
            version: CONST.INTERNAL_ADDR_CONTRACT_MAP[hex].compilerVersion,
            evmVersion: 'Default',
            optimization: CONST.INTERNAL_ADDR_CONTRACT_MAP[hex].optimization,
            runs: CONST.INTERNAL_ADDR_CONTRACT_MAP[hex].runs,
            libraries: '',
            license: 'MIT',
            constructorArgs: '',
        })
    }

    private async getVerifyBySourcify(contractAddress, withDetail = false) {
        const hex = ethers.getAddress(format.hexAddress(contractAddress));

        const hit = this._getCache(hex, withDetail);
        if (hit) {
            return hit;
        }

        const local = await this.getVerifyByDB(contractAddress, withDetail);
        if (local) {
            this._addCache(hex, local);
            return local;
        }

        const fields = `?fields=compilation${withDetail ? ',stdJsonInput,abi,creationBytecode.transformationValues' : ''}`;
        const resp = await ContractQuery._getJsonRequest({
            url: `${this.verifyUrl}/contract/${StatApp.networkId}/${hex}${fields}`
        });
        if (!resp) {
            return null;
        }

        const {matchId, address, match, abi, compilation, stdJsonInput, licenseType, contractLabel, similarMatchChainId,
            similarMatchAddress, creationBytecode, verifiedAt} = resp.data;
        if (!match) {
            return null;
        }

        if (!withDetail) {
            const verified = {address: format.address(address, StatApp.networkId), name: compilation.name};
            this._addCache(hex, verified);
            return verified;
        }

        let {
            compiler,
            language,
            compilerVersion,
            compilerSettings,
            fullyQualifiedName,
        } = compilation;
        console.log('Succeed to get contract compilation info', JSON.stringify({
            language,
            compilerVersion,
            compilerSettings,
            fullyQualifiedName,
        }));

        for (const [key, value] of Object.entries(stdJsonInput.sources)) {
            stdJsonInput.sources[key].content = (value as any).content;
        }
        let sourceCode;
        if(fullyQualifiedName.startsWith(':')) {
            fullyQualifiedName = fullyQualifiedName.substring(1);
            sourceCode = stdJsonInput.sources[''].content;
        } else{
            sourceCode = JSON.stringify(stdJsonInput);
        }

        if(language === CONST.LANGUAGE.VYPER) {
            const versions = await this.listVyperVersions();
            compilerVersion = convertVyperVersion(compilerVersion, versions);
            fullyQualifiedName = contractLabel;
        }

        const addressId = await makeIdV(address);
        const verified = {
            address: format.address(address, StatApp.networkId),
            addressId,
            name: fullyQualifiedName,
            compiler,
            version: compilerVersion,
            language,
            evmVersion: compilerSettings?.evmVersion ? compilerSettings.evmVersion : "Default",
            optimization: language === CONST.LANGUAGE.VYPER ? (compilerSettings?.optimize || '0') :
                (compilerSettings?.optimizer?.enabled ? '1' : '0'),
            runs: compilerSettings?.optimizer?.runs,
            libraries: compilerSettings?.libraries,
            license: CONST.CONTRACT_LICENSE[licenseType || 1].code,
            constructorArgs: similarMatchChainId ? undefined : creationBytecode.transformationValues?.constructorArguments,
            codeFormat: `${language}${sourceCode.startsWith("{") ? "(Json)" : ""}`,
            sourceCode,
            abi: JSON.stringify(abi),
            similarMatchChainId,
            similarMatchAddress,
            matchId,
            verifiedAt: verifiedAt.replace('T', ' ').replace(/T$/, ''),
        } as VerifiedContracts;

        this.traceCreate.query(contractAddress).then(async item => {
            const {epochNumber, from} = item;
            verified.deployer = from;
            verified.epochNumber = epochNumber;
            const count = await AddressTransactionIndex.count({where: {addressId}});
            const pruneInfo = await PruneInfo.findOne({where: {addressId, type: PruneType.ADDR_TX}});
            verified.txns = count + (pruneInfo?.pruned || 0);
            const contract = await Contract.findOne({attributes: ['name'], where: {hex40id: addressId}, raw: true});
            const nametag = await NameTag.findOne({where: {hex40id: addressId}, raw: true});
            verified.hasNametag = Boolean(contract?.name || nametag?.nameTag || nametag?.labels);
            await VerifiedContracts.upsert({...verified, libraries: JSON.stringify(verified.libraries)});
        }).catch(err => safeAddErrorLog("contract-query", "get-verify-by-sourcify", err));

        this._addCache(hex, verified);

        this.saveABI(address, abi).then();

        return verified;
    }

    private async listVerifyBySourcify(addresses: string[]) {
        const addressesParam = addresses.map(item => ethers.getAddress(format.hexAddress(item))).join(',');

        const resp = await ContractQuery._getJsonRequest({
            url: `${this.verifyUrl}/contracts/${StatApp.networkId}?addresses=${addressesParam}`,
        });

        if(!resp) {
            return [];
        }

        return resp.data.results.map(item => ({
            address: format.address(item.address, StatApp.networkId),
            name: item.name,
        }));
    }

    private async getVerifyByDB(contractAddress, withDetail = false) {
        const attributes: any[] = ['address', 'name'];

        if(withDetail) {
            attributes.push(...['language', 'sourceCode', 'name', 'abi', 'version', 'evmVersion', 'optimization',
                'runs', 'libraries', 'license', 'constructorArgs', 'similarMatchChainId', 'similarMatchAddress']);
        }

        return VerifiedContracts.findOne({
            attributes,
            where: {address: format.address(contractAddress, StatApp.networkId)},
            raw: true,
        });
    }

    private async listVerifyByDB(addresses: string[]) {
        return VerifiedContracts.findAll({
            attributes: [
                'address',
                'name',
            ],
            where: {
                address: {[Op.in]: addresses.map(item => format.address(item, StatApp.networkId))},
            },
            order: [['id', 'DESC']],
            raw: true,
        })
    }

    async getImpl(address: string): Promise<ImplInfo | undefined> {
        const impl = await this._getImpl(address);
        if (!impl) {
            return;
        }

        const hex = await Hex40Map.findOne({
            where: {hex: format.hexAddress(impl.implementation).substr(2)},
            raw: true,
        });
        if (!hex) {
            return;
        }

        this._updateImpl(address, impl).then();

        return impl;
    }

    private async _getImpl(address: string): Promise<ImplInfo | undefined>{
        const hex = format.hexAddress(address);
        const validSlotValue = (value: string) => value && value !== CONST.ZERO_VALUE_IN_SLOT;

        const impl = await Promise.all([
            CONST.IMPLEMENTATION_SLOT_OZ, // ZeppelinOS Proxy
            CONST.IMPLEMENTATION_SLOT_EIP1822, // PROXIABLE Proxy (EIP-1822)
            CONST.POSITION_IMPLEMENTATION_SLOT, // EIP1967 Proxy (EIP-1967)
        ].map(slot => this.cfx.getStorageAt(hex, slot))).then(values => {
            const value = values.find(validSlotValue);
            return value ? `0x${value.substr(26)}` : undefined;
        });

        if (impl) {
            return {
                implementation: fmtAddr(impl, StatApp.networkId),
                proxyPattern: CONST.PROXY_PATTERN.PROXY,
            };
        }

        const beacon = await this.cfx.getStorageAt(hex, CONST.POSITION_BEACON_SLOT).then(value => {
            return validSlotValue(value) ? `0x${value.substr(26)}` : ZERO_LABS_PROXY_BEACON_MAP[hex];
        });

        if (!beacon) {
            return;
        }

        const beaconImpl = await this.cfx.Contract({abi}).implementation()
            .call({to: beacon}, undefined)
            .then(format.hexAddress)
            .catch(() => undefined);

        if (!beaconImpl) {
            return;
        }

        return {
            beacon: fmtAddr(beacon, StatApp.networkId),
            implementation: fmtAddr(beaconImpl, StatApp.networkId),
            proxyPattern: CONST.PROXY_PATTERN.BEACON_PROXY,
        };
    }

    private async _updateImpl(contract: string, impl: ImplInfo) {
        const {implementation, proxyPattern, beacon} = impl || {};
        if (implementation) {
            const cid = (await makeId(contract)).id;
            const implId = (await makeId(implementation)).id;
            const beaconId = beacon ? (await makeId(beacon)).id : 0;
            await ContractImpl.bulkCreate([{
                cid, implId, beaconId, proxyType: proxyPattern,
            }], {
                updateOnDuplicate: ['implId', 'beaconId', 'proxyType', 'updatedAt'],
            });
        }
    }

    public async queryDestroyInfo(address) {
        const hex = format.hexAddress(address);

        if(lodash.includes(CONST.INTERNAL_CONTRACT, hex)){
            return CONST.DEPLOY_STATUS.DEPLOYED;
        }
        const {codeHash} = await this.cfx.getAccount(hex);
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
        const base32 = formatToBase32(address);
        expectedImpl = !expectedImpl ? null : formatToBase32(expectedImpl);

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

        const {implementation} = await this.getImpl(record.base32) || {};

        return lodash.assign(
            lodash.pick(record, ['guid', 'base32', 'expectedImpl']),
            {proxy: !!implementation, implementation}
        );
    }

    private genGUID(base32){
        const plain = `${base32}${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const random = sign.keccak256(Buffer.from(plain)).toString('hex');
        return random.substr(0, 50);
    }

    async scheduleUpdateCompilerVersions(delay: number = 1000 * 60 * 60 * 12) { // update every 12 hours
        const that = this;

        async function repeat() {
            await that.updateSolcVersions().catch(e => {
                safeAddErrorLog('ContractQuery', 'updateSolcVersions', e).then();
                console.log('Schedule update compiler versions fail', e);
            });

            await that.updateSolcVulnerabilities().catch(e => {
                safeAddErrorLog('ContractQuery', 'updateSolcVulnerabilities', e).then();
                console.log('Schedule update compiler vulnerabilities fail', e);
            });

            await that.updateVyperVersions().catch(e => {
                safeAddErrorLog('ContractQuery', 'updateVyperVersions', e).then();
                console.log('Schedule update compiler versions fail', e);
            });

            setTimeout(repeat, delay);
        }

        repeat().then();
        console.log(`[contract_compiler_version]schedule in ${delay/1000}s interval`);
    }

    // shortVersion => fullVersion
    private async updateSolcVersions() {
        const resp = await ContractQuery._getJsonRequestByAxios({
            url: 'https://binaries.soliditylang.org/bin/list.json',
            handleError: false,
        });
        const {data} = resp;
        const versions = lodash.mapValues(data.releases, solcName => solcName.substring(8, solcName.length - 3));
        await KV.upsert({key: KEY_SOLC_VERSIONS, value: JSON.stringify(versions)});
    }

    // shortVersion => vulnerabilities
    private async updateSolcVulnerabilities() {
        const resp = await ContractQuery._getJsonRequestByAxios({
            url: 'https://raw.githubusercontent.com/argotorg/solidity/refs/heads/develop/docs/bugs_by_version.json',
            handleError: false,
        });
        const {data} = resp;
        const vulnerabilities = Object.fromEntries(Object.entries(data)
            .map(([shortVer, bugInfo]: [string, any]) => [shortVer, bugInfo.bugs.length]));
        await KV.upsert({key: KEY_SOLC_VULNERABILITIES, value: JSON.stringify(vulnerabilities)});
    }

    // shortVersion => {desc, commit}
    private async updateVyperVersions() {
        const versions = {};
        let page = 1;

        while (true) {
            const resp = await ContractQuery._getJsonRequest({
                url: `https://api.github.com/repos/vyperlang/vyper/tags?page=${page}&per_page=100`,
                headers: {
                    'User-Agent': 'Vyper-Version-Checker'
                },
                handleError: false,
            }).catch(e => {
                if (e.status === 429) {
                    return null;
                }
                throw e;
            });

            if (!resp) {
                continue;
            }

            const {data: list} = resp;

            if (!list?.length) {
                break;
            } else {
                list.filter(v => v.name.startsWith('v')).forEach(v => {
                    const ver = v.name.substring(1);
                    versions[ver] = {
                        desc: `vyper:${ver}`,
                        commit: v.commit.sha.substring(0, 8)
                    };
                });
                page++;
            }
        }

        if (Object.keys(versions).length) {
            await KV.upsert({key: KEY_VYPER_VERSIONS, value: JSON.stringify(versions)});
        }
    }

    async listSolcVersions(): Promise<{ [shortVersion: string]: string }> {
        return this.listCompilerVersions(KEY_SOLC_VERSIONS);
    }

    async listSolcVulnerabilities(): Promise<{ [shortVersion: string]: number }> {
        return this.listCompilerVersions(KEY_SOLC_VULNERABILITIES);
    }

    async listVyperVersions(): Promise<{ [shortVersion: string]: { desc: string, commit: string } }> {
        return this.listCompilerVersions(KEY_VYPER_VERSIONS);
    }

    private async listCompilerVersions(key: string): Promise<any> {
        let versions = this.CACHE_COMPILER_VERSIONS.get(key);
        if (!versions) {
            versions = JSON.parse(await KV.getString(key, "{}"));
            this.CACHE_COMPILER_VERSIONS.set(key, versions, this.cacheCompilerTtl);
        }
        return versions;
    }

    async listEVMVersions(): Promise<string[]> {
        const value = await KV.getString(KEY_EVM_VERSIONS, '');

        if(!value) {
            await KV.create({key: KEY_EVM_VERSIONS, value: CONST.EVM_VERSION.join(',')})
            console.log(`EVM versions not set, use default!`)
            return CONST.EVM_VERSION;
        }

        return value.split(',');
    }

    public async verify(verifyInput: VerifyInput) {
        let {
            contractAddress, sourceCode, codeFormat, fullQualifiedName,
            compilerVersion, optimizationUsed, runs,
            constructorArguments, evmVersion, licenseType,
        } = verifyInput;
        checkPresent({contractAddress, sourceCode, compilerVersion, fullQualifiedName},
            ['contractAddress', 'sourceCode', 'compilerVersion', 'fullQualifiedName']);

        checkCodeFormat(codeFormat);

        let jsonInput, contractPath, contractName, contractLabel;
        if(CONST.CONTRACT_CODE_FORMATS_SOLIDITY.includes(codeFormat)) {
            const versions = await this.listSolcVersions();
            compilerVersion = checkSolcVersion(compilerVersion, versions);
            if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.SOLIDITY_STANDARD_JSON_INPUT.code){
                jsonInput = JSON.parse(sourceCode);
                optimizationUsed = jsonInput.settings.optimizer.enabled;
                runs = jsonInput.settings.optimizer.runs;
            }
            const optimize = checkSolcOptimization(optimizationUsed, runs);
            optimizationUsed = optimize.optimizationUsed;
            runs = optimize.runs;
            const fqn = splitFullyQualifiedName(fullQualifiedName);
            contractPath = fqn.contractPath;
            contractName = fqn.contractName;
            contractLabel = '';
        } else {
            const versions = await this.listVyperVersions();
            compilerVersion = checkVyperVersion(compilerVersion, versions);
            if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.VYPER_JSON.code) {
                jsonInput = JSON.parse(sourceCode);
                optimizationUsed = jsonInput.settings.optimize;
            }
            optimizationUsed = checkVyperOptimization(optimizationUsed);
            const fqn = splitFullyQualifiedName(fullQualifiedName);
            if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.VYPER_SINGLE_FILE.code) {
                contractPath = ".";
                contractName = "";
            } else{
                contractPath = fqn.contractPath;
                contractName = path.parse(fqn.contractPath).name;
            }
            contractLabel = fqn.contractName || 'Vyper_contract';
        }

        const librariesInfo: Record<string, {name: any; address: any;}> = {};
        for(let i = 1; i <= 10; i++) {
            librariesInfo[`library${i}`] = {
                name: verifyInput[`libraryName${i}` as keyof typeof verifyInput],
                address: verifyInput[`libraryAddress${i}` as keyof typeof verifyInput]
            };
        }
        const libraries = checkLibrary(librariesInfo);

        evmVersion = await checkEVMVersion(evmVersion, (await this.listEVMVersions()));

        licenseType = checkLicense(licenseType);

        if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.SOLIDITY_SINGLE_FILE.code) {
            jsonInput = {
                language: CONST.LANGUAGE.SOLIDITY,
                sources: {
                    [contractPath]: {
                        content: this._rmRedundantLicense(sourceCode),
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
            };
        }

        if(codeFormat === CONST.CONTRACT_CODE_FORMAT_INFO.VYPER_SINGLE_FILE.code) {
            jsonInput = {
                language: CONST.LANGUAGE.VYPER,
                sources: {
                    [contractPath]: {
                        content: sourceCode,
                    },
                },
                settings: {
                    evmVersion,
                    optimize: optimizationUsed,
                },
            };
        }

        const trace: any = await TraceCreateContract.sequelize.query(
            "select concat('0x',txHash) as txHash from trace_create_contract where `to` = (select id from hex40 where hex=?)",
            {
                type: QueryTypes.SELECT,
                replacements:[contractAddress.substr(2)]
            }).then(traces => {return traces?.length ? traces[0] : undefined});

        const input: VerifyFromJsonInput = {
            chainId: StatApp.networkId,
            address: contractAddress,
            jsonInput,
            compilerVersion: compilerVersion,
            compilationTarget: {
                name: contractName,
                path: contractPath,
            },
            constructorArguments,
            creationTransactionHash: trace?.txHash,
            licenseType,
            contractLabel,
        };

        const verifyResult = await this.verifyFromJsonInput(input);
        this.saveABI(contractAddress).then();
        return verifyResult;
    }

    public async verifyByLink(
        verifyInput: VerifyByLinkInput
    ) {
        const contractAddress = verifyInput.contractAddress;

        const input: VerifyFromCrossChain = {
            chainId: StatApp.networkId,
            address: contractAddress,
            linkChainIds: verifyInput.linkChainIds,
        };
        const verifyResult = await this.verifyFromCrossChain(input);

        this.saveABI(contractAddress).then();

        return verifyResult;
    }

    private async verifyFromJsonInput(
        input: VerifyFromJsonInput,
    ): Promise<VerifyResponse | VerifyErrorResponse> {
        const result = await ContractQuery._postJsonRequest({
            url: `${this.verifyUrl}/verify/${input.chainId}/${input.address}`,
            body: {
                stdJsonInput: input.jsonInput,
                compilerVersion: input.compilerVersion,
                contractIdentifier: `${input.compilationTarget.path}:${input.compilationTarget.name}`,
                constructorArguments: input.constructorArguments,
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

    private async verifyFromCrossChain(
        input: VerifyFromCrossChain
    ): Promise<VerifyResponse | VerifyErrorResponse> {
        const result = await ContractQuery._postJsonRequest({
            url: `${this.verifyUrl}/verify/crosschain/${input.chainId}/${input.address}`,
            body: {
                linkChainIds: input.linkChainIds?.join(","),
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
                if(verified?.abi) {
                    return
                }
            } else {
                const hexId = await getAddrId(address)
                saveAbiInfo(abi, hexId).catch(e => {
                    console.log(`saveAbiInfo ${address}`, e)
                })
                return
            }
            await sleep(interval)
            interval *= 2
        }
    }

    public async checkVerification(
        verificationId: string
    ): Promise<VerificationJob> {
        const result = await ContractQuery._getJsonRequest({
            url: `${this.verifyUrl}/verify/${verificationId}`,
        });

        if(!result) {
            return {
                verificationId,
                isJobCompleted: false,
            } as VerificationJob
        }

        return result.data as VerificationJob
    }

    public async getVerificationResult(
        verificationId: string,
        retry: number = 10,
        intervalMs: number = 3000,
    ): Promise<VerificationResult> {
        for (let i = 0; i < retry; i++) {
            const job: VerificationJob = await this.checkVerification(verificationId);
            if (!job.isJobCompleted) {
                await sleep(intervalMs);
                continue;
            }

            if (job?.error) {
                const e = job.error;
                return {
                    error: e?.message ? `${e.customCode}:${e.message}` : `${e.customCode}`,
                };
            }

            return {
                match: !!job.contract.match,
            };
        }

        return {
            error: 'Pending in queue, please check contract detail page later!',
        };
    }

    static async _postJsonRequest(
        {
            url,
            body,
            headers = {},
            timeout = 1000 * 30,
            handleError = true,
        }) {
        try {
            if (!ContractQuery.verifyEnable) {
                return null;
            }

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
            if (!handleError) {
                throw error
            }
            ContractQuery._handleHttpError(url, error)
        }
    }

    static async _getJsonRequest(
        {
            url,
            headers = {},
            timeout = 1000 * 30,
            handleError = true,
        }) {
        try {
            if (!ContractQuery.verifyEnable) {
                return null;
            }

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
            if (!handleError) {
                throw error
            }
            ContractQuery._handleHttpError(url, error)
        }
    }

    static async _getJsonRequestByAxios({
        url,
        headers = {},
        timeout = 1000 * 30,
        handleError = true,
    }) {
        try {
            const response = await axios({
                method: 'GET',
                url,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...headers
                },
                timeout,
                family: 4,
            });

            return {
                status: response.status,
                data: response.data,
                headers: response.headers
            };
        } catch (error) {
            if (!handleError) {
                throw error
            }
            ContractQuery._handleHttpError(url, error)
        }
    }

    static _handleHttpError(url, error) {
        const err = new Error(error.message || 'HTTP request failed')
        err['code'] = error.status
        err['stack'] = error.stack
        err['location'] = __filename

        if (err['code'] === 404) {
            return null
        }

        if (
            err['code'] === undefined ||
            (err['code'] >= 500 && err['code'] <= 504)
        ) {
            console.log(`Business is busy, url ${url}`)
            return null
        }

        throw err
    }

    _rmRedundantLicense(sourceCode) {
        if (!sourceCode) {
            return sourceCode;
        }
        let result = sourceCode.replace('SPDX-License-Identifier', '__license__');
        result = result.replace(/SPDX-License-Identifier/gi, 'SLI');
        result = result.replace('__license__', 'SPDX-License-Identifier');
        return result;
    }

    _addCache(key: string, val: any) {
        try {
            const withDetail = !!val?.language?.length;
            (withDetail ? this.CACHE_VERIFY_DETAIL : this.CACHE_VERIFY_ADDRESS).set(key, val, this.cacheTtl);
        } catch (e) {
            //error: Cache max keys amount exceeded
        }
    }

    _getCache(key: string, withDetail: boolean = false) {
        return (withDetail ? this.CACHE_VERIFY_DETAIL : this.CACHE_VERIFY_ADDRESS).get(key);
    }

    async scheduleVerifyByAuto(delay: number = 1000) {
        const that = this;

        async function repeat() {
            await that.verifyByTrace().catch(e => {
                safeAddErrorLog('ContractQuery', 'verifyByTrace', e).then();
                console.log('Schedule verify by auto fail', e);
            });

            await that.verifyByVerification().catch(e => {
                safeAddErrorLog('ContractQuery', 'verifyByVerification', e).then();
                console.log('Schedule verify by auto fail', e);
            });

            setTimeout(repeat, delay);
        }

        repeat().then();
        console.log(`[auto_verify]schedule in ${delay/1000}s interval`);
    }

    private async verifyByTrace() {
        const cursor = await KV.getNumber(KEY_AUTO_VERIFY_TRACE_ID, 0);

        const trace = await TraceCreateContract.sequelize.query(`
                select 
                    t.id as id, 
                    concat('0x', h.hex) as address
                from trace_create_contract t  
                join hex40 h on t.to = h.id 
                where t.id > ? 
                order by t.id asc limit 1
            `, {
            type: QueryTypes.SELECT,
            replacements: [cursor],
        }).then((list: any[]) => (list?.length ? list[0] : null));

        if (!trace) {
            return;
        }

        await this.verifyByAuto(trace.address);
        await KV.saveNumber(KEY_AUTO_VERIFY_TRACE_ID, trace.id);
    }

    private async verifyByVerification() {
        const cursor = await KV.getNumber(KEY_AUTO_VERIFY_VERIFY_ID, 0);

        const verified = await VerifiedContracts.findOne({
            attributes: ['id', 'address'],
            where: {id: {[Op.gt]: cursor}},
            order: [['id', 'asc']],
        })

        if (!verified) {
            return;
        }

        const {codeHash} = await this.cfx.getAccount(verified.address);

        const addresses = await TraceCreateContract.sequelize.query(`
                select 
                    concat('0x', h.hex) as address
                from trace_create_contract t  
                join hex40 h on t.to = h.id 
                where t.codeHash = ? 
            `, {
            type: QueryTypes.SELECT,
            replacements: [codeHash],
        }).then((list: any[]) => list.map(item => item.address));

        for (const address of addresses) {
            await this.verifyByAuto(address);
        }

        await KV.saveNumber(KEY_AUTO_VERIFY_VERIFY_ID, verified.id);
    }

    private async verifyByAuto(
        address: string,
        retry: number = 3,
        intervalMs: number = 5000,
    ) {
        const {codeHash} = await this.cfx.getAccount(address);
        if (codeHash === CONST.CODEHASH_NO_BYTECODE) {
            const hex = await Hex40Map.findOne({where: {hex: address.substr(2)}});
            TraceCreateContract.update({codeHash}, {where: {to: hex.id}}).then();
            return;
        }

        const verified = await this.queryVerify(address, true);
        if (verified) {
            return;
        }

        for (let i = 0; i < retry; i++) {
            if (i === retry) {
                throw new Error("Retry exceeds max times");
            }

            const input: VerifyByLinkInput = {
                contractAddress: address,
                linkChainIds: [StatApp.networkId],
            };

            const submit: any = await this.verifyByLink(input);
            if (submit.message) {
                await sleep(intervalMs);
                continue; // retry
            }

            const {error, match} = await this.getVerificationResult(submit.verificationId);

            if (error?.includes("internal_error")) {
                throw new Error(error);
            }
            if (match
                || error?.includes("already_verified")
                || error?.includes("contract_not_deployed")
                || error?.includes("no_similar_match_found")) {
                break;
            }
            if (error?.includes("Pending in queue")) {
                await sleep(intervalMs); // retry
            }
        }
    }

    private heartBeat() {
        if (!ContractQuery.verifyEnable) {
            return;
        }

        setInterval(async () => {
            const url = `${this.verifyUrl}/health`;
            try {
                await superagent.get(url)
                    .timeout({response: 3_000, deadline: 3_000})
                    .then(ack => {
                            if (ack?.text !== "Alive and kicking!") {
                                throw new Error("No response!")
                            }
                        }
                    )
                if (!HeartBeatBean.sequelize) {
                    console.log(`${__filename} DB has not been initialized`)
                    return
                }
                await doHeartBeat(`${KEY_COMPILER}_${ConfigInstance.serverTag}`);
            } catch (e) {
                console.log(`Failed to check verification health ${url}\n ${e.status} ${e.message}`);
            }
        }, 10_000);
    }

    static async listMethodABIBySourcify(hash: string, timeout: number = 3000) {
        try {
            const resp = await ContractQuery._getJsonRequestByAxios({
                url: `${ConfigInstance.verification.url}/abi/${hash}`,
                timeout,
            });

            const {data} = resp || {};

            if (data?.results?.length) {
                const list = data.results.map((item: any) => ({
                    hash,
                    type: "function",
                    fullName: item.signature,
                    formatWithArg: item.fullFormat,
                }));
                AbiInfo.bulkCreate(list, {
                    updateOnDuplicate: ['updatedAt']
                }).then();
                return list;
            }
        } catch (e) {
            safeAddErrorLog('ContractQuery', 'listMethodABI', e).then();
        }

        return [];
    }

    public async scheduleStatTxnVolume(interval = 3000) {
        async function updateTxnsCountById(addressId) {
            const count = await AddressTransactionIndex.count({where: {addressId}});
            const pruneInfo = await PruneInfo.findOne({where: {addressId, type: PruneType.ADDR_TX}});
            const txns = count + (pruneInfo?.pruned || 0);
            await VerifiedContracts.update({txns}, {where: {addressId}});
        }

        let lastId = 0;
        while (true) {
            const list = await VerifiedContracts.findAll({
                attributes: ['id', 'addressId'],
                where: {id: {[Op.gt]: lastId},}, offset: 0, limit: 1000, order: [['id', 'ASC']],
            });
            const size = list?.length;
            if (!size) {
                break;
            }
            console.log(`start to stat txns for ${size} contracts...`);
            for (let i = 0; i < size; i++) {
                const {id, addressId} = list[i];
                await updateTxnsCountById(addressId);
                lastId = id;
            }
        }

        async function updateTxnsCount() {
            const maxEpoch: number = await loadMaxBlockEpoch();
            const curEpoch = await KV.getNumber(KEY_STAT_TXNS_FOR_VERIFIED_CONTRACTS, 0)
            const minEpoch = Math.max(curEpoch, maxEpoch - 1000);
            const addressIds = await FullBlock.sequelize.query(`
            select distinct(fromId) as id from ${FullTransaction.getTableName()} 
            where epoch >= :minEpoch and epoch <= :maxEpoch
            union 
            select distinct(toId) as id from ${FullTransaction.getTableName()} 
            where epoch >= :minEpoch and epoch <= :maxEpoch`, {
                type: QueryTypes.SELECT, replacements: {minEpoch, maxEpoch}, raw: true
            }).then(items => {
                return items.map((item: any) => item.id)
            });
            for (const addressId of addressIds) {
                const verify = await VerifiedContracts.findOne({where: {addressId}});
                if (verify) {
                    await updateTxnsCountById(addressId);
                }
            }
            await KV.upsert({key: KEY_STAT_TXNS_FOR_VERIFIED_CONTRACTS, value: `${maxEpoch}`})
        }

        async function repeat() {
            await updateTxnsCount().catch(e => {
                console.log('Schedule stat_txns_of_verified_contracts fail', e);
            });
            setTimeout(repeat, interval);
        }

        repeat().then();
        console.log(`[stat_txns_of_verified_contracts]schedule in ${interval / 1000}s interval`);
    }

    public async scheduleWithNametag(interval = 3000) {
        async function updateWithNametag() {
            const maxEpochAnnounceName = await Contract.findOne({order: [["epoch", "desc"]]}).then(r => r?.epoch ?? 0);
            const curEpochAnnounceName = await KV.getNumber(KEY_STAT_ANNOUNCE_NAME_FOR_VERIFIED_CONTRACTS, 0);
            const addrArr1 = await Contract.findAll({
                attributes: ["hex40id"],
                where: {
                    [Op.and]: [
                        {epoch: {[Op.between]: [curEpochAnnounceName, maxEpochAnnounceName]}},
                        {[Op.and]: [{name: {[Op.ne]: null}}, {name: {[Op.ne]: ""}}]},
                    ]
                },
                raw: true,
            }).then(list => list.map((item: any) => item.hex40id));

            const maxEpochNametag = await NameTag.findOne({order: [["epoch", "desc"]]}).then(r => r?.epoch ?? 0);
            const curEpochNametag = await KV.getNumber(KEY_STAT_NAME_TAG_FOR_VERIFIED_CONTRACTS, 0);
            const addrArr2 = await NameTag.findAll({
                attributes: ["hex40id"],
                where: {
                    [Op.and]: [
                        {epoch: {[Op.between]: [curEpochNametag, maxEpochNametag]}},
                        {
                            [Op.or]: [
                                {[Op.and]: [{nameTag: {[Op.ne]: null}}, {nameTag: {[Op.ne]: ""}}]},
                                {[Op.and]: [{labels: {[Op.ne]: null}}, {labels: {[Op.ne]: ""}}]},
                            ]
                        }
                    ]
                },
                raw: true,
            }).then(list => list.map((item: any) => item.hex40id));

            const addressIds = new Set([...addrArr1, ...addrArr2]);
            for (const addressId of [...addressIds]) {
                await VerifiedContracts.update({hasNametag: true}, {where: {addressId}});
            }

            await KV.upsert({key: KEY_STAT_ANNOUNCE_NAME_FOR_VERIFIED_CONTRACTS, value: `${maxEpochAnnounceName}`});
            await KV.upsert({key: KEY_STAT_NAME_TAG_FOR_VERIFIED_CONTRACTS, value: `${maxEpochNametag}`});
        }

        async function repeat() {
            await updateWithNametag().catch(e => {
                console.log('Schedule stat_withNametag_of_verified_contracts fail', e);
            });
            setTimeout(repeat, interval);
        }

        repeat().then();
        console.log(`[stat_withNametag_of_verified_contracts]schedule in ${interval / 1000}s interval`);
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

export interface VerifyByLinkInput {
    contractAddress: string;
    linkChainIds?: number[];
}

export interface VerifyFromJsonInput {
    chainId: number;
    address: string;
    jsonInput: SolidityJsonInput | VyperJsonInput;
    compilerVersion: string;
    compilationTarget: CompilationTarget;
    constructorArguments?: string;
    creationTransactionHash?: string;
    licenseType: number;
    contractLabel: string;
}

export interface VerifyFromCrossChain {
    chainId: number;
    address: string;
    linkChainIds?: number[];
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

export interface VerificationResult {
    error?: string;
    match?: boolean;
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

export interface ImplInfo {
    implementation: string,
    proxyPattern: string,
    beacon?: string,
}

export type MatchLevel = "match" | "exact_match" | null;
