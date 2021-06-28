// @ts-ignore
import {format} from "js-conflux-sdk";
import {StatApp} from "../StatApp";
const {Contract} = require("../model/Contract");
const {DailyContractStat} = require("../model/DailyContractStat");
import {toBase32} from "./tool/AddressTool";
import {decodeUtf8} from "./tool/StringTool";
import {DailyTransaction} from "../model/DailyTransaction";
import {Hex40Map} from "../model/HexMap";
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

    async listStat(address, skip: number = 0, limit: number = 1000) {
        const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(address).substr(2)}})
        const hex40id = hex40?.id
        if(hex40id === undefined){
            return {total: 0};
        }

        const page = await DailyContractStat.findAndCountAll({
            attributes: ['statTime', 'tx', 'cfxTransfer', 'tokenTransfer'],
            where: {hex40id}, offset: skip, limit, order:[["statTime", "DESC"]]
        })
        return { total: page?.count || 0, list: page?.rows };;
    }
}
