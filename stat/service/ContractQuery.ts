import {AddressTransactionIndex} from "../model/FullBlock";
import {CfxBalance} from "../model/Balance";
import {toBase32} from "./tool/AddressTool";
import {
    Hex40Map,
    hex40IdMap,
    POCKET_ADDRESS_MAP,
    idHex40Map,
    convert2base32map,
    ESpaceHex40Map,
} from "../model/HexMap";
import {Op, QueryTypes} from "sequelize";
import {fmtAddr, StatApp} from "../StatApp";
import {saveAbiInfo} from "../model/ContractInfo";
import {Desensitizer} from "./Desensitizer";
import {ContractDestroy, TraceCreateContract} from "../model/TraceCreateContract";
import {ProxyVerify} from "../model/ContractVerify";
import {Errors} from "./common/LogicError";
import {CONST} from "./common/constant"
import {ConfigInstance} from "../config/StatConfig";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {ScanApp, ScanCtx} from "../../scan-api/service/index";

const { format, sign } = require('js-conflux-sdk');
const lodash = require('lodash');
const superagent = require('superagent');
const {Contract} = require("../model/Contract");
const {ContractVerify} = require("../model/ContractVerify");
const abi = require('./tool/abi');

export class ContractQuery {
    public app: ScanApp;


    constructor(app: ScanApp) {
        this.app = app;
    }

    public async sync({id}) {
        return Contract.findOne({where: {id}})
    }

    public async syncVerify({id}) {
        return ContractVerify.findOne({where: {id}})
    }

    public async count({name}) {
        return Contract.count({where: {name}});
    }

    public async query({address, fields = undefined}) {
        let base32 = toBase32(address);
        const response = await this.list({addressArray: [base32], fields});
        return (response.list)[0] || {};
    }

    public async list({addressArray, fields, skip= 0, limit= 10}: {
        addressArray?: string[], fields?: string[], skip?: number, limit?: number
    }) {
        const options: any = {raw: true};
        // fields
        let attributes: any = [
            'hex40id',
            ['base32', 'address'],
            'name',
            'website',
        ];
        if (lodash.includes(fields, 'abi')) {
            attributes.push('abi');
        }
        if (lodash.includes(fields, 'sourceCode')) {
            attributes.push('sourceCode');
        }
        options.attributes = attributes;
        // where
        const where: any = {};
        if(addressArray?.length){
            addressArray = addressArray.map(item => toBase32(item));
            where.base32 = { [Op.in]: addressArray } ;
        }
        options.where = where;
        // query
        let rawList;
        let count;
        if (addressArray) {
            rawList = await Contract.findAll(options);
            rawList?.forEach(item => {
                item.name = Desensitizer.mosaicStr(item.address, item.name);
            });
            count = rawList?.length || 0;
        } else{
            options.offset = skip;
            options.limit = limit;
            const page = await Contract.findAndCountAll(options)
            rawList = page?.rows;
            count = page?.count;
        }
        const list = [];
        if(rawList){
            rawList.forEach( row => {
                if(row['abi']) {
                    row['abi'] = row['abi'];
                }
                if(row['sourceCode']) {
                    row['sourceCode'] = row['sourceCode'];
                }
                list.push(row);
            });
        }

        return { total: count || 0, list };
    }

    public async addVerify({address, sourceCode = undefined, name, compiler, version, optimizeFlag, optimizeRuns,
        license, libraries, evmVersion,
        taskStatus = CONST.TASK_STATUS.PROCESSING, verifyResult = undefined, codeHash = undefined}) {
        const base32 = toBase32(address);

        const verify = new ContractVerify();
        verify.base32 = base32;
        verify.sourceCode = sourceCode;
        verify.name = name;
        verify.compiler = compiler;
        verify.version = version;
        verify.optimizeFlag = optimizeFlag;
        verify.optimizeRuns = optimizeRuns;
        verify.license = license;
        verify.libraries = JSON.stringify(libraries);
        verify.evmVersion = evmVersion;
        verify.taskStatus = taskStatus;
        verify.verifyResult = verifyResult;
        verify.codeHash = codeHash;
        verify.guid = this.genGUID(base32);

        const verified = await ContractVerify.findOne({where: {base32, verifyResult: true}});
        if (verified !== null) {
            throw new Errors.ContractVerifyError(`Contract source code already verified`);
        }

        const result = await ContractVerify.add(verify);
        console.log(`[${address}]stat verify request ${result.base32} ${result.verifyResult}`);
        return result;
    }

    public async updateVerify({id, address = undefined, version = undefined, constructorArgs = undefined,
        abi = undefined, verifyResult = undefined, matchCode = undefined, matchDesc = undefined,
        taskStatus = undefined, warnings = undefined, errors = undefined}){
        const base32 = toBase32(address);

        const dbVerify = await ContractVerify.findOne({where: {id}, raw: true});
        if(dbVerify.base32 !== base32){
            console.log(`[${address}]updateVerify`, 'updateError', `record.base32 not equals ${base32}`);
        }

        const updateVerify = lodash.defaults({}, {version, constructorArgs, verifyResult, matchCode, matchDesc,
            taskStatus, warnings, errors, updatedAt: new Date()});
        if(verifyResult){
            const proxyInfo = await this.queryImplementation(base32)
                .catch((e) => {
                    safeAddErrorLog('contract',`query-impl-${base32}`, e);
                    console.log(`[${address}]updateVerify`, 'queryImplError', e.toString())
                });
            lodash.assign(updateVerify, {abi}, proxyInfo, {notifyStatus: CONST.NOTIFY_STATUS.NEED_NOTIFY});
        } else{
            lodash.assign(updateVerify, {sourceCode: null});
        }
        const result = await ContractVerify.update(updateVerify, {where: {id: dbVerify.id}});

        if(verifyResult){
            saveAbiInfo(abi).catch(e => {
                safeAddErrorLog('contract',`save-abi-info`, e);
                console.log(`[${address}]updateVerify.saveAbiInfo`, e)
            });
            await this.linkVerify({address, codeHash: dbVerify.codeHash})
                .catch(e => {
                    safeAddErrorLog('contract',`link-verify-${address}`, e);
                    console.log(`[${address}]updateVerify.linkVerify`, e)
                });
            await this.verifyMinimalProxy({address, implVerifyId: dbVerify.id})
                .catch(e => {
                    safeAddErrorLog('contract',`verify-minimal-proxy-${address}`, e);
                    console.log(`[${address}]updateVerify.minimalVerify`, e)
                });
        }
        console.log(`[${address}]updateVerify`, 'updateResult', `${JSON.stringify(result)}`);

        return result;
    }

    private async linkVerify({address, codeHash}) {
        const traceCreates = await TraceCreateContract.findAll({ attributes: ['to'], where: {codeHash}, raw: true });
        if(!traceCreates?.length){
            return;
        }

        const hexIdArray = traceCreates.map(item => item.to);
        const hexIdHexMap = await idHex40Map([...hexIdArray])
        const hexIdBase32Map = convert2base32map(hexIdHexMap)

        const base32Array = [...hexIdBase32Map.values()];
        const verifiedArray = await ContractVerify.findAll({
            attributes: ['base32'], where: {verifyResult: true, base32: {[Op.in]: base32Array}}, raw: true,
        }).then(arr => arr.map(t => t.base32));
        const toVerifyArray = lodash.filter(base32Array, item => !lodash.includes(verifiedArray, item));
        if(!toVerifyArray?.length){
            return;
        }

        const base32 = toBase32(address);
        const matchVerify = await ContractVerify.findOne({
            where: {base32, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if (!matchVerify) {
            return;
        }

        const similarMatch = matchVerify.base32;
        const createdAt = new Date();
        const bytecode = await this.exactBytecode({address: similarMatch, constructorArgs: matchVerify.constructorArgs});
        for (const base32 of toVerifyArray) {
            const constructorArgs = await this.exactConstructorArgs({address: base32, bytecode});
            const matchRecord = lodash.assign(matchVerify, CONST.MATCH_STATUS.SIMILAR,
                { id: undefined, implementation: undefined, base32, constructorArgs, similarMatch, createdAt,
                    updatedAt: createdAt });
            await ContractVerify.create(matchRecord).catch((e) => {
                safeAddErrorLog('contract',`save-contract-verify-${base32}`, e);
            });
        }
    }

    public async verifyMinimalProxy({address, implVerifyId}) {
        const base32 = toBase32(address);
        const proxyVerifyArray = await ContractVerify.findAll({
            where: {implementation: base32, verifyResult: false, proxyPattern: 'Minimal Proxy Contract'},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if(!proxyVerifyArray?.length){
            return;
        }

        const implVerify = await ContractVerify.findOne({where: {id: implVerifyId}, raw: true});
        for(const dbVerify of proxyVerifyArray) {
            const proxyVerify = lodash.pick(dbVerify, ['id', 'base32',
                'proxy', 'implementation', 'proxyPattern', 'codeHash', 'similarMatch', 'guid',
                'taskStatus', 'notifyStatus', 'createdAt']);
            const verify = lodash.assign(implVerify, proxyVerify, {updatedAt: new Date()});
            await ContractVerify.update(verify, {where: {id: dbVerify.id}}).catch((error) => {
                safeAddErrorLog('contract',`update-contract-verify`, error);
                console.log(`${__filename} update contract verify : `, error)
            });
        }
    }

    public async exactBytecode({address, constructorArgs}) {
        const creationData = await this.getCreationData({address});
        const bytecode = (!constructorArgs || constructorArgs === '0x') ? creationData :
            creationData.substr(0, creationData.length - constructorArgs.length + 2);
        return bytecode;
    }

    public async exactConstructorArgs({address, bytecode}) {
        const creationData = await this.getCreationData({address});
        const constructorArgs = creationData.substr(bytecode.length);
        return `0x${constructorArgs || ''}`;
    }

    public async queryVerify({address}) {
        const base32 = toBase32(address);

        // own verified info
        const verified = await ContractVerify.findOne({where: {base32, verifyResult: true}, useMaster: true, raw: true});
        if(!verified) {
            return verified
        }

        // real-time impl info
        const proxyInfo = await this.queryImplementation(base32)
            .catch((e) => {
                safeAddErrorLog('contract',`query-impl-2-${base32}`, e);
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
            let verifiedInfo = await ContractVerify.findOne({where: {base32: toBase32(verified.beacon),
                    verifyResult: true}, raw: true});
            verified.beaconVerified = verifiedInfo != null;
        }
        if(verified?.implementation){
            let verifiedInfo = await ContractVerify.findOne({where: {base32: toBase32(verified.implementation),
                    verifyResult: true}, raw: true});
            verified.implementationVerified = verifiedInfo != null;
        }
        if(verified?.libraries && verified?.libraries?.length > 2){
            const libs = [];
            lodash.forIn(JSON.parse(verified.libraries), (lib, libKey) =>{
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
            const verifyArray = await ContractVerify.findAll({ attributes: ['base32'],
                where: {base32: {[Op.in]: libs.map(item => item.address)}, verifyResult: true}, raw: true});
            verifyArray?.forEach(item => verifyMap[item.base32] = true);
            libs.forEach(item => ( item['exactMatch'] = !!verifyMap[item.address]));
            verified.libraries = libs;
        } else{
            verified.libraries = {};
        }

        return verified;
    }

    public async queryDestroyInfo({address}) {
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

    public async listVerify({addressArray, skip = 0, limit = 10, reverse = true,
                                verifyResult = true, detail = false}) {
        const options: any = { offset: skip, limit, raw: true};
        // fields
        options.attributes = [
            'id',
            'name',
            // 'hex40id',
            ['base32', 'address'],
            'compiler',
            'version',
            'constructorArgs',
            'sourceCode',
            ['optimizeFlag', 'optimization'],
            ['optimizeRuns', 'runs'],
            'license',
            ['updatedAt', 'timestamp'],
        ];

        // where
        const where: any = { verifyResult };
        if(addressArray){
            if (!lodash.isArray(addressArray)) {
                addressArray = [addressArray];
            }
            addressArray = addressArray.map(item => toBase32(item));
            where.base32 = {[Op.in]: addressArray};
            options.offset = 0;
            options.limit = addressArray.length;
        }
        options.where = where;

        // order by
        options.order = [['id', `${reverse ? 'DESC' : 'ASC'}`]];

        //query
        const page = await ContractVerify.findAndCountAll(options);
        const list = page?.rows || [];
        for(const row of list) {
            row.optimization = row.optimization === 1;
            row.timestamp = row.timestamp.getTime() / 1000;
        }
        if(detail){
            await Promise.all(list.map(async contract =>{
                const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(contract.base32).substr(2)}})
                const hex40id = hex40?.id
                const transactionCount = await AddressTransactionIndex.count({where: {addressId: hex40id}});
                const balance = await CfxBalance.findOne({where: {addressId: hex40id}});
                contract.transactionCount = transactionCount;
                contract.balance = balance?.total || 0;
            }));
        }

        return  {total: page?.count || 0, list};
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
            this.list({ addressArray }).then(response => response.list.map(contract => {
                return { address: contract.address, name: contract.name }})),
            this.listVerify({ addressArray }).then(response => response.list.map(verified => verified.address)),
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

    public async queryImplementation(base32) {
        const {cfx} = this.app;
        let result = {proxy: false};
        const implementation = await Promise.all([
            CONST.POSITION_IMPLEMENTATION_SLOT,
            CONST.IMPLEMENTATION_SLOT_OZ,
            CONST.IMPLEMENTATION_SLOT_EIP1822,
        ].map(slot=>{
            return cfx.getStorageAt(base32, slot).then(res=>{
                return res;
            })
        }))
            .then(arr=>arr.find(implementation=>implementation !== null && implementation !== CONST.ZERO_VALUE_IN_SLOT))

        const [beacon] = await Promise.all([
            cfx.getStorageAt(base32, CONST.POSITION_BEACON_SLOT),
        ]);

        let beaconHex40;
        let implHex40;
        if (implementation) {
            implHex40 = implementation.substr(26);
        }
        if (beacon !== null && beacon !== CONST.ZERO_VALUE_IN_SLOT) {
            beaconHex40 = `0x${beacon.substr(26)}`;
            const contract = cfx.Contract({abi});
            const impl = await contract.implementation()
                .call({to: beaconHex40}, undefined)
                .catch((e) => {
                    safeAddErrorLog('contract',`call-impl-on-${beaconHex40}`, e);
                    console.log(`failed to call ${beaconHex40} `, e)
                });
            implHex40 = format.hexAddress(impl).substr(2)
        }
        if (!implHex40) return result;

        const hex40 = await Hex40Map.findOne({where: {hex: implHex40}, raw: true});
        if (!hex40) return result;

        const beaconAddress = beaconHex40 ? fmtAddr(beaconHex40, StatApp.networkId) : null;
        const implAddress = fmtAddr(`0x${hex40.hex}`, StatApp.networkId);
        return lodash.assign(result, {
            proxy: true,
            beacon: beaconAddress,
            implementation: implAddress,
            proxyPattern: "OpenZeppelin's Unstructured Storage"
        });
    }

    // verify sourcecode
    public async verify({ address, name, sourcecode, compiler, optimizeRuns, license, libraries, evmVersion, constructorArgs }) {
        const { cfx, jsonRpc } = this.app;

        const sourceCode = this.rmRedundantLicense(sourcecode);
        const response = { name, sourceCode, optimizeRuns };

        const code = await cfx.getCode(address);
        if (code === undefined || code === '0x') {
            return lodash.assign(response, { errors: [`invalid contract's code:${code}`] });
        }
        const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');

        const verify = await this.queryVerify({ address });
        if (verify !== null) {
            return lodash.assign(response, { errors: ['the contract already verified!'] });
        }

        try {
            const optimizeFlag = Number.isInteger(optimizeRuns) && optimizeRuns >= 0;
            const record = await this.addVerify({address, sourceCode, name, compiler: 'solidity', version: compiler,
                optimizeFlag, optimizeRuns, license, libraries, evmVersion, codeHash});

            const creationData = await this.getCreationData({ address })
                .catch(e => {
                    safeAddErrorLog('contract',`get-creation-data-${address}`, e);
                    throw new Errors.QueryCreationDataError(e)
                });
            const result = await jsonRpc.verifyPlus({address, creationData, deployedBytecode: code, name, sourceCode,
                compiler, optimizeRuns});
            result.verifyResult = this.getVerifyResult(result.matchCode);
            result.warnings = result.warnings.map((v) => v.formattedMessage || v.message);
            result.errors = result.errors.map((v) => v.formattedMessage || v.message);

            const updateRecord = {id: record.id, address, abi: JSON.stringify(result.abi),
                constructorArgs: result.encodedConstructorArgs};
            lodash.assign(updateRecord, lodash.pick(result, ['version', 'verifyResult', 'matchCode', 'matchDesc' ]));
            const updateVerify = await this.updateVerify(updateRecord);

            console.log(JSON.stringify({ src: `[${address}]verify`, updateVerify: `${JSON.stringify(updateVerify)}` }));
            return lodash.assign(response, lodash.pick(result, ['version', 'warnings', 'errors', 'abi']),
                {exactMatch: result.verifyResult});
        } catch (e) {
            console.log(JSON.stringify({ src: `[${address}]verify`, error: `${e.message}` }));
            return lodash.assign(response, { errors: [e.message] });
        }
    }

    // open api verify
    public async submitVerify({ address, name, sourcecode, compilerType, compilerVersion, optimizeFlag, optimizeRuns,
        license, constructorArgs, libraries, evmVersion }) {
        const { cfx, jsonRpc } = this.app;

        try{
            const verified = await ContractVerify.findOne({where: {base32: toBase32(address), verifyResult: true}});
            if (verified !== null) {
                throw new Errors.ContractVerifyError(`Contract source code already verified`);
            }
            address = format.hexAddress(address);
            const code = await cfx.getCode(address);
            if (code === undefined || code === '0x') {
                throw new Errors.ContractVerifyError(`Invalid contract's code:${code}`);
            }
            const sourceCode = this.rmRedundantLicense(sourcecode);
            const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');

            // check version
            const versionTable = await jsonRpc.listVersion(); // call compiler jsonrpc
            const versionSet = new Set();
            (Object.values(versionTable) as string[]).forEach(version => {
                versionSet.add(version.substring(8, version.length - 3));
            });
            if(!versionSet.has(compilerVersion)){
                throw new Errors.ContractVerifyError(`Compiler version ${compilerVersion} not exits`)
            }

            const record = await this.addVerify({address, sourceCode, name, compiler: compilerType,
                version: compilerVersion, optimizeFlag, optimizeRuns, license, libraries, evmVersion, codeHash,
                taskStatus: CONST.TASK_STATUS.SUBMITTED});
            return { address, guid: record.guid };

        }catch (e) {
            console.log(JSON.stringify({ src: `[${address}]submitVerify`, error: `${e.message}` }));
            return { address, error: e.message };
        }
    }

    public async doVerify({ id, address, fileName, name, sourceCode, compilerType, compilerVersion, optimizeFlag,
        optimizeRuns, license, libraries, evmVersion, constructorArgs }) {
        const { cfx, jsonRpc } = this.app;

        try {
            address = format.hexAddress(address);
            await this.queryVerify({ address }).catch((e) => {
                safeAddErrorLog('contract',`query-verify-${address}`, e);
                throw new Errors.ContractVerifyError(`the contract already verified`)
            });
            const code = await cfx.getCode(address).catch((e) => {
                safeAddErrorLog('contract',`get-code-${address}`, e);
                throw new Errors.ContractVerifyError(`Unable to locate ContractCode at ${address}`)
            });
            const creationData = await this.getCreationData({ address })
                .catch(e => {
                    safeAddErrorLog('contract',`get-creation-data-${address}`, e);
                    throw new Errors.QueryCreationDataError(e)
                });

            const updateVerify = {taskStatus: CONST.TASK_STATUS.PROCESSING};
            const lockResult = await ContractVerify.update(updateVerify, {where: { id,
                    taskStatus: CONST.TASK_STATUS.SUBMITTED}});
            if(!lockResult[0]){
                console.log(JSON.stringify({ src: `[${address}]doVerify`, error: `acquire lock fail` }));
                return;
            }

            optimizeRuns = (optimizeFlag && optimizeRuns > 0) ? optimizeRuns : undefined;
            const result = await jsonRpc.verifyPlus({address, creationData, deployedBytecode: code, name,
                fileName, sourceCode, compilerType, compilerVersion, optimizeRuns, libraries, evmVersion});
            result.verifyResult = this.getVerifyResult(result.matchCode);
            result.warnings = result.warnings.map((v) => v.formattedMessage || v.message);
            result.errors = result.errors.map((v) => v.formattedMessage || v.message);

            const updateRecord = {
                id, address,
                abi: JSON.stringify(result.abi),
                constructorArgs: result.encodedConstructorArgs,
                warnings: JSON.stringify(result.warnings),
                errors: JSON.stringify(result.errors),
                version: result.compilerVersion,
            };
            lodash.assign(updateRecord, lodash.pick(result, ['verifyResult', 'matchCode', 'matchDesc' ]));
            lodash.assign(updateRecord, {taskStatus: CONST.TASK_STATUS.DONE});
            await this.updateVerify(updateRecord);

        } catch (e) {
            if(e instanceof Errors.QueryCreationDataError) {
                await ContractVerify.update({taskStatus: CONST.TASK_STATUS.SUBMITTED},
                    {where: { id, taskStatus: CONST.TASK_STATUS.PROCESSING}});
                return
            }

            console.log(JSON.stringify({ src: `[${address}]doVerify`, error: `${e.message}` }));
            const updateRecord = {
                id, address,
                verifyResult: false,
                errors: e.message,
            };
            lodash.assign(updateRecord, CONST.MATCH_STATUS.ERROR);
            lodash.assign(updateRecord, {taskStatus: CONST.TASK_STATUS.DONE});
            await this.updateVerify(updateRecord).catch((e) => {
                safeAddErrorLog('contract',`update-verify-${address}`, e);
                console.log(`${__filename} update verify:`, e)
            });
        }
    }

    public async checkVerify({ guid }) {
        return ContractVerify.findOne({where: {guid}, raw: true});
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
        return { address, guid: record.guid };;
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

    private rmRedundantLicense(sourceCode) {
        let result = sourceCode.replace('SPDX-License-Identifier', '__license__');
        result = result.replace(/SPDX-License-Identifier/gi, 'SLI');
        result = result.replace('__license__', 'SPDX-License-Identifier');
        return result;
    }

    private async getCreationData({ address }) {
        const { cfx, tokenTool } = this.app;

        const hexAddress = format.hexAddress(address);
        const sql = "select * from trace_create_contract where `to` = (select id from hex40 where hex = ?)";
        const array = await TraceCreateContract.sequelize.query(sql, {type: QueryTypes.SELECT,
            replacements:[hexAddress.substr(2)] }) as TraceCreateContract[];
        const transactionHash = array?.length ? '0x' + array[0].txHash : undefined;

        const transaction = await cfx.getTransactionByHash(transactionHash);
        if (ConfigInstance.traceNotAvailable) {
            return transaction.data;
        }

        const transactionTraceArray = await cfx.traceTransaction(transaction.hash);
        const traceArray = await tokenTool.matchTrace(transactionTraceArray, transaction);
        const creatTraceArray = traceArray.filter(trace => (trace.type === CONST.TRACE_TYPE.CREATE &&
            trace.transactionHash === transaction.hash &&
            format.hexAddress(trace.action.to) === hexAddress));
        const traceCreate = creatTraceArray[0];

        return traceCreate.action.init;
    }

    private getVerifyResult(matchCode) {
        return matchCode === CONST.MATCH_STATUS.INTERNAL_CONTRACT.matchCode ||
            matchCode === CONST.MATCH_STATUS.DEPLOYED_FULL.matchCode ||
            matchCode === CONST.MATCH_STATUS.DEPLOYED_PARTIAL.matchCode ||
            matchCode === CONST.MATCH_STATUS.CREATION_FULL.matchCode ||
            matchCode === CONST.MATCH_STATUS.CREATION_PARTIAL.matchCode ||
            matchCode === CONST.MATCH_STATUS.SIMILAR.matchCode;
    }

    private genGUID(base32){
        const plain = `${base32}${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const random = sign.keccak256(Buffer.from(plain)).toString('hex');
        return random.substr(0, 50);
    }

    public async schedule(delay: number = 3000) {
        console.log(`schedule async_verify with delay: ${delay}`);
        const that = this;
        async function repeat() {
            await that.run();
            setTimeout(repeat, delay)
        }
        repeat().then();
    }

    private async run() {
        await this.processVerify().catch(e => {
            safeAddErrorLog('contract',`process-verify`, e);
            console.log(`schedule doVerify error: ${e.message}`)
        });
        await this.processSyncAcrossRegion().catch(e => {
            safeAddErrorLog('contract',`sync-across-region`, e);
            console.log(`schedule notifyVerify error: ${e.message}`)
        });
    }

    private async processVerify() {
        let submitVerify = await ContractVerify.findOne({
            where: {taskStatus: CONST.TASK_STATUS.SUBMITTED},
            order: [['createdAt', 'ASC']],
            raw: true
        });
        if(!submitVerify) {
            return;
        }

        submitVerify.address = submitVerify.base32;
        submitVerify.compilerType = submitVerify.compiler;
        submitVerify.compilerVersion = submitVerify.version;
        submitVerify.libraries = JSON.parse(submitVerify.libraries);
        if(submitVerify.name.indexOf(":") > -1) {
            const parts = submitVerify.name.split(":");
            submitVerify.fileName = parts[0];
            submitVerify.name = parts[1];
        }
        await this.doVerify(submitVerify);
    }

    private async processSyncAcrossRegion(){
        const { config } = this.app;
        if (!config.syncAcrossRegionHost) {
            return;
        }
        let verify = await ContractVerify.findOne({
            where: {
                verifyResult: true,
                notifyStatus: CONST.NOTIFY_STATUS.NEED_NOTIFY
            },
            order: [['createdAt', 'ASC']],
            raw: true
        });
        if(!verify) {
            return;
        }

        const verifyRequest = {
            contractaddress: verify.base32,
            sourceCode: verify.sourceCode,
            codeformat: verify.compiler,
            contractname: verify.name,
            compilerversion: verify.version,
            optimizationUsed: verify.optimizeFlag,
            runs: verify.optimizeRuns,
            constructorArguements: verify.constructorArgs,
            evmversion: verify.evmVersion,
            licenseType: lodash.findKey(CONST.LICENSE, (v) => v.code === verify.license),
        };

        if(verify.libraries?.length > 2) {
            const libs = JSON.parse(verify.libraries)
            lodash.forEach(Object.keys(libs), (libName: string, index: number) => {
                const idx = ++index // The index starts at 1
                verifyRequest[`libraryname${idx}`] = libName
                verifyRequest[`libraryaddress${idx}`] = libs[libName]
            });
        }

        let verifyUrl = `${config.syncAcrossRegionHost}/contract/verifysourcecode`;
        if (StatApp.isEVM) {
            lodash.assign(verifyRequest, {module: 'contract', action: 'verifysourcecode'});
            verifyUrl = `${config.syncAcrossRegionHost}/api`;
        }

        let response;
        try{
            response = await superagent.post(verifyUrl)
                .set('Content-Type', 'application/json')
                .send(verifyRequest)
                .timeout(60 * 1000);
            console.log(`[${verify.base32}]sync verify submit:${JSON.stringify(response.text)}`);
        } catch (error){
            console.log(`[${verify.base32}]sync verify error:`, error)
        }

        if(response?.status === 200){
            await ContractVerify.update({notifyStatus: CONST.NOTIFY_STATUS.NOTIFIED}, {where: {id: verify.id}});
        }
    }
}
