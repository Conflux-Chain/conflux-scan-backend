// @ts-ignore
import {format} from "js-conflux-sdk";
import {Hex40Map} from "../model/HexMap";
const {Contract} = require("../model/Contract");
const {DailyContractStat} = require("../model/DailyContractStat");
const {ContractVerify} = require("../model/ContractVerify");
import {AddressTransactionIndex} from "../model/FullBlock";
import {CfxBalance} from "../model/Balance";
import {toBase32} from "./tool/AddressTool";
import {decodeUtf8} from "./tool/StringTool";
import {makeId} from "../model/HexMap";
import {Op} from "sequelize";
import {StatApp} from "../StatApp";

const lodash = require('lodash');

export class ContractQuery {
    protected app: any;
    public addressNameMap: Map<string, any>

    constructor(app: any) {
        this.app = app;
    }

    public async count(name) {
        return Contract.count({where: {name}});
    }

    public async query(address, fields = undefined) {
        const{ logger } = this.app;

        let base32 = toBase32(address);
        // logger?.info({src: `ContractQuery.query.rdb`, base32: `${JSON.stringify(base32)}`});
        const result = await this.list(fields, 0, 1, [base32]);
        // logger?.info({src: `ContractQuery.query.rdb`, result: `${JSON.stringify(result)}`});
        const contract = result?.list?.shift();
        // logger?.info({src: `ContractQuery.query.rdb`, contract: `${JSON.stringify(contract)}`});
        return contract || {};
    }

    public async list(fields, skip: number = 0, limit: number = 10, addressArray) {
        const options: any = {raw: true};
        // fields
        let attributes: any = [
            ['base32', 'address'],
            'hex40id',
            'name',
            'website',
        ];
        if(fields && fields.length>0){
            if(!lodash.isArray(fields)){
                fields = [fields];
            }
            const set = new Set(fields);
            if(set.has('abi')){
                attributes.push('abi');
            }
            if(set.has('sourceCode')){
                attributes.push('sourceCode');
            }
            if(set.has('icon')){
                attributes.push('icon');
            }
        }
        options.attributes = attributes;

        // query
        const query: any = {};
        if(addressArray){
            addressArray = addressArray.map(item => toBase32(item));
            query.base32 = { [Op.in]: addressArray } ;
        }
        options.where = query;

        // page
        options.offset = skip;
        options.limit = limit;
        const page = await Contract.findAndCountAll(options)
        const list = [];
        if(page && page.rows){
            page.rows.forEach( row => {
                if(row['abi']) {
                    row['abi'] = row['abi'];
                }
                if(row['sourceCode']) {
                    row['sourceCode'] = row['sourceCode'];
                }
                list.push(row);
            });
        }
        return { total: page?.count || 0, list };
    }

    public async listRegisterAddress() {
        const options: any = {attributes: ['base32', 'hex40id'], raw: true};
        const tokenList = await Contract.findAll(options)
        const list = [];
        if(tokenList){
            tokenList.forEach( item => {
                const hex40 = format.hexAddress(item.base32);
                list.push(hex40);
            });
        }
        return { total: list.length, list };
    }

    public async addVerify({name, address, compiler, version, optimizeFlag, optimizeRuns, license, verifyResult, similarity}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);
        const hex40id = (await makeId(address)).id;

        const verify = new ContractVerify();
        verify.base32 = base32;
        verify.hex40id = hex40id;
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

    public async updateVerify({id, address, version, sourceCode, abi, verifyResult, similarity}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);

        const dbVerify = await ContractVerify.findOne({where: {id}, raw: true});
        if(dbVerify.base32 !== base32){
            logger?.error({ src: `[${address}]stat verify request`, updateError: `record.base32 not equals ${base32}` });
        }

        const updateInfo = lodash.defaults({}, {verifyResult, similarity, version, updatedAt: new Date()});
        let updateVerify = lodash.assign(dbVerify, updateInfo);
        if(verifyResult){
            updateVerify = lodash.assign(updateInfo, {sourceCode, abi});
        }
        const result = await ContractVerify.update(updateVerify, {where: {id: dbVerify.id}});
        logger?.info({ src: `[${address}]stat verify request`, updateResult: `${JSON.stringify(result)}` });
        return result;
    }

    public async queryVerify({address}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);

        const result = await ContractVerify.findOne({where: {base32, verifyResult: true}});
        //logger?.info({ src: `[${address}]stat verify request`, queryResult: `${JSON.stringify(result)}` });
        return result;
    }

    public async listVerify({addressArray, skip = 0, limit = 10, reverse = true,
                                verifyResult = true, detail = false}) {
        const options: any = { offset: skip, limit, raw: true};
        // fields
        let attributes: any = [
            'name',
            'hex40id',
            ['base32', 'address'],
            'compiler',
            'version',
            ['optimizeFlag', 'optimization'],
            ['optimizeRuns', 'runs'],
            ['updatedAt', 'timestamp'],
        ];
        options.attributes = attributes;

        // where
        const query: any = {verifyResult};
        if(addressArray){
            if (!lodash.isArray(addressArray)) {
                addressArray = [addressArray];
            }
            addressArray = addressArray.map(item => toBase32(item));
            query.base32 = {[Op.in]: addressArray};
            options.skip = 0;
            options.limit = addressArray.length;
        }
        options.where = query;

        // order by
        const order = [['updatedAt', `${reverse ? 'DESC' : 'ASC'}`]];
        options.order = order;

        //query
        const page = await ContractVerify.findAndCountAll(options);
        const list = page?.rows || [];
        for(const row of list) {
            row.optimization = row.optimization === 1;
            row.timestamp = row.timestamp.getTime() / 1000;
        }
        if(detail){
            await Promise.all(list.map(async contract =>{
                const transactionCount = await AddressTransactionIndex.count({where: {addressId: contract.hex40id}});
                const balance = await CfxBalance.findOne({where: {addressId: contract.hex40id}});
                contract.transactionCount = transactionCount;
                contract.balance = balance?.total || 0;
            }));
        }

        return  {total: page?.count || 0, list};
    }

    public async listBasic({ addressArray}) {
        const {
            app: { config, tokenQuery, service, tokenTool, confluxSDK },
        } = this;
        if(addressArray === undefined){
            return {total: 0, map: {}}
        }

        // remove repeat
        addressArray = [...new Set(addressArray.filter(Boolean).map(address => format.hexAddress(address)))];
        addressArray = addressArray.filter((address) => address?.startsWith('0x8'));
        if (addressArray.length === 0) {
            return { total: 0, map: {} };
        }
        const networkId = StatApp.networkId || this.app?.networkId;
        addressArray = addressArray.map(address => format.address(address, networkId));

        // init
        const map = {};
        addressArray.forEach((address) => { map[address] = {contract: {address}, token: {address}}; });

        // query contract and token
        const tokenService = tokenQuery || service.tokenRdb;
        const [ verifyContractAddressSet, contractArray, tokenArray ] = await Promise.all([
            this.listVerify({ addressArray })
                .then(response => new Set<string>(response.list.map(verifyInfo => verifyInfo.address))),
            this.list(undefined, 0, addressArray.length, addressArray)
                .then(response => response.list.map(announceInfo => {
                    return { address: announceInfo.address, name: announceInfo.name };
                })),
            tokenService.list(addressArray, ['icon'], undefined, undefined, undefined, undefined, 0, addressArray.length)
                .then(response => response.list),
        ]);

        // build response
        contractArray.forEach((contract) => {
            map[contract.address].contract = lodash.defaults(map[contract.address].contract, {
                name: contract.name,
                verify: { result: verifyContractAddressSet.has(contract.address) ? 1 : 0 },
            });
        });
        verifyContractAddressSet.forEach((verifyContractAddress) => {
            map[verifyContractAddress].contract = lodash.defaults(map[verifyContractAddress].contract, {
                verify: { result: 1 },
            });
        });
        tokenArray.forEach((token) => {
            map[token.address].token = lodash.defaults(map[token.address].token, {
                name: token.name,
                symbol: token.symbol,
                icon: token.icon,
                decimals: token.decimals
            });
        });

        return { total: addressArray.length, map };
    }
}
