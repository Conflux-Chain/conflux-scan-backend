// @ts-ignore
import {format} from "js-conflux-sdk";
import {Hex40Map} from "../model/HexMap";
const {Contract} = require("../model/Contract");
const {DailyContractStat} = require("../model/DailyContractStat");
const {ContractVerify} = require("../model/ContractVerify");
import {AddressTransactionIndex} from "../model/FullBlock";
import {toBase32} from "./tool/AddressTool";
import {decodeUtf8} from "./tool/StringTool";
import {makeId} from "../model/HexMap";

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
        const result = await this.list(fields, 0, 1, base32);
        // logger?.info({src: `ContractQuery.query.rdb`, result: `${JSON.stringify(result)}`});
        const contract = result?.list?.shift();
        // logger?.info({src: `ContractQuery.query.rdb`, contract: `${JSON.stringify(contract)}`});
        return contract || {};
    }

    public async list(fields, skip: number = 0, limit: number = 10, address) {
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
        if(address){
            query.base32 = address;
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
                if(row['icon']) {
                    row['icon'] = decodeUtf8(row['icon']);
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

    public async updateVerify({id, address, verifyResult, similarity, version}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);

        const dbVerify = await ContractVerify.findOne({where: {id}, raw: true});
        if(dbVerify.base32 !== base32){
            logger?.error({ src: `[${address}]stat verify request`, updateError: `record.base32 not equals ${base32}` });
        }

        const updateInfo = lodash.defaults({}, {verifyResult, similarity, version, updatedAt: new Date()});
        const updateVerify = lodash.assign(dbVerify, updateInfo);
        const result = await ContractVerify.update(updateVerify, {where: {id: dbVerify.id}});
        logger?.info({ src: `[${address}]stat verify request`, updateResult: `${JSON.stringify(result)}` });
        return result;
    }

    public async queryVerify({address}) {
        const{ logger } = this.app;
        const base32 = toBase32(address);

        const result = await ContractVerify.findOne({where: {base32, verifyResult: true}});
        logger?.info({ src: `[${address}]stat verify request`, queryResult: `${JSON.stringify(result)}` });
        return result;
    }

    public async listVerify({skip = 0, limit = 10, reverse = true, verifyResult = true}) {
        const{ logger, cfxSDK } = this.app;
        const page = await ContractVerify.findAndCountAll({
            attributes: [
                'name',
                'hex40id',
                ['base32', 'address'],
                'compiler',
                'version',
                ['optimizeFlag', 'optimization'],
                ['optimizeRuns', 'runs'],
                ['updatedAt', 'timestamp'],
            ],
            where: {verifyResult},
            order: [['updatedAt', `${reverse ? 'DESC' : 'ASC'}`]],
            offset: skip, limit, raw: true});
        logger?.info({ src: `list stat verify request`, page: `${JSON.stringify(page)}` });
        const list = page?.rows || [];
        for(const row of list) {
            row.optimization = row.optimization === 1;
            row.timestamp = row.timestamp.getTime() / 1000;
            row.transactionCount = await AddressTransactionIndex.count({where: {addressId: row.hex40id}});
            row.balance = (await cfxSDK.getBalance(row.address)).toString();
        }
        logger?.info({ src: `list stat verify request`, list: `${JSON.stringify(list)}` });

        return  {total: list.length, list};;
    }
}
