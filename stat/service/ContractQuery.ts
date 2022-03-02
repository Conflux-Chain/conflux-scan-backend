// @ts-ignore
import {format} from "js-conflux-sdk";
import {AddressTransactionIndex} from "../model/FullBlock";
import {CfxBalance} from "../model/Balance";
import {toBase32} from "./tool/AddressTool";
import {Hex40Map, hex40IdMap, makeId, POCKET_ADDRESS_MAP} from "../model/HexMap";
import {Op} from "sequelize";
import {StatApp} from "../StatApp";
import {saveAbiInfo} from "../model/ContractInfo";
import {Desensitizer} from "./Desensitizer";
import {TraceCreateContract} from "../model/TraceCreateContract";

const lodash = require('lodash');
const CONST = require('./common/constant');
const {Contract} = require("../model/Contract");
const {ContractVerify} = require("../model/ContractVerify");

export class ContractQuery {
    protected app: any;

    constructor(app: any) {
        this.app = app;
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

    public async listAddress() {
        const options: any = {attributes: ['base32'], raw: true};
        const contractArray = await Contract.findAll(options)

        const addressArray = contractArray.map(item => format.hexAddress(item.base32));
        return {total: addressArray.length, list: addressArray};
    }

    public async addVerify({name, address, compiler, version, optimizeFlag, optimizeRuns, license, verifyResult, similarity}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);
        // const hex40id = (await makeId(address)).id;

        const verify = new ContractVerify();
        verify.base32 = base32;
        // verify.hex40id = hex40id;
        verify.name = name;
        verify.compiler = compiler;
        verify.version = version;
        verify.optimizeFlag = optimizeFlag;
        verify.optimizeRuns = optimizeRuns;
        verify.license = license;
        verify.verifyResult = verifyResult;
        verify.similarity = similarity;
        const result = await ContractVerify.add(verify);
        logger?.info({ src: `[${address}]stat verify request`, addResult: `${JSON.stringify(result)}` });
        return result;
    }

    public async updateVerify({id, address, version, constructorArgs, sourceCode, abi, verifyResult, similarity,
        creationData}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);

        const dbVerify = await ContractVerify.findOne({where: {id}, raw: true});
        if(dbVerify.base32 !== base32){
            logger?.error({ src: `[${address}]stat verify request`, updateError: `record.base32 not equals ${base32}` });
        }

        const updateInfo = lodash.defaults({}, {version, constructorArgs, verifyResult, similarity, creationData,
            updatedAt: new Date()});
        let updateVerify = lodash.assign(dbVerify, updateInfo);
        if(verifyResult){
            const proxyInfo = await this.queryImplementation(base32)
                .catch((e) => logger.error({ src: 'updateVerify', msg: e.toString() }));
            updateVerify = lodash.assign(updateInfo, {sourceCode, abi}, proxyInfo);
            try {
                const abiObj = JSON.parse(abi);
                saveAbiInfo(abiObj).then();
            } catch (e) {
                console.log(`error, save abi info, ${base32}`, e);
            }
        }
        const result = await ContractVerify.update(updateVerify, {where: {id: dbVerify.id}});
        logger?.info({ src: `[${address}]stat verify request`, updateResult: `${JSON.stringify(result)}` });

        return result;
    }

    public async queryVerify({address}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);

        let verified = await ContractVerify.findOne({where: {base32, verifyResult: true}, raw: true});
        if(verified !== null){
            const proxyInfo = await this.queryImplementation(base32)
                .catch((e) => logger.error({ src: 'queryVerify', msg: e.toString() }));
            if(proxyInfo?.implementation){
                verified.implementation = proxyInfo.implementation;
            }
        }

        // extra info
        if(verified?.implementation){
            let verifiedInfo = await ContractVerify.findOne({where: {base32: verified.implementation,
                    verifyResult: true}, raw: true});
            verified.implementationVerified = verifiedInfo != null ? true : false;
        }

        return verified;
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
        options.order = [['updatedAt', `${reverse ? 'DESC' : 'ASC'}`]];

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
        } = this;

        // remove repeat
        addressArray = [...new Set(addressArray.filter(Boolean).map(address => format.hexAddress(address)))];
        if (addressArray.length === 0) { return { total: 0, map: {} };}

        const hexIdMap = await hex40IdMap(addressArray);
        const traceCreates = await TraceCreateContract.findAll({where: {to: {[Op.in]: [...hexIdMap.values()]}}});
        const registeredContracts = await Contract.findAll({where: {hex40id: {[Op.in]: [...hexIdMap.values()]}}});
        const hexIdArray = [...new Set([...traceCreates.map(item => item.to), ...registeredContracts.map(item => item.hex40id)])];
        if (hexIdArray.length === 0) { return { total: 0, map: {} };}

        const idHexMap = {};
        hexIdMap.forEach((hexId,hex) => (idHexMap[hexId] = hex));
        addressArray = [];
        hexIdArray.forEach(hexId => addressArray.push(`0x${idHexMap[hexId]}`));

        const networkId = StatApp.networkId || this.app?.networkId;
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
                v1: POCKET_ADDRESS_MAP[contract.name], v2: format.hexAddress(contract.address),
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

        return {total: addressArray.length, map};
    }

    private async queryImplementation(base32){
        const{ cfx, cfxSDK } = this.app;
        const sdk = cfxSDK || cfx;
        let result = { proxy: false };

        const implementation = await sdk.getStorageAt(base32, CONST.POSITION_IMPLEMENTATION_SLOT);
        if(implementation === null) return result;
        const hex40 = await Hex40Map.findOne({where: {hex: implementation.substr(26)}, raw: true});
        if(hex40 === null) return result;
        const address = format.address(`0x${hex40.hex}`, this.app?.networkId);

        return lodash.assign(result, {proxy: true, implementation: address, proxyPattern: "OpenZeppelin's Unstructured Storage"});
    }
}
