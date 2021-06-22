// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {DailyToken, Token} from "../model/Token";
const addressSdk = require('js-conflux-sdk/src/util/address')
const lodash = require('lodash');
import {decodeUtf8} from "./tool/StringTool";
const {Hex40Map} = require("../model/HexMap");
import {StatApp} from "../StatApp";
import {toBase32} from "./tool/AddressTool";
import {Contract} from "../model/Contract";
const {Erc20Transfer} = require("../model/Erc20Transfer");
const {Erc721Transfer} = require("../model/Erc721Transfer");
const {Erc777Transfer} = require("../model/Erc777Transfer");
const {Erc1155Transfer} = require("../model/Erc1155Transfer");
const CONST = require('./common/constant');

export class TokenQuery {
    protected app: any;

    constructor(app: any) {
        this.app = app;
    }

    public async query(address, fields = undefined, currency = undefined) {
        const {
            app: { tokenTool, confluxSDK },
        } = this;

        let base32 = toBase32(address);
        const result = await this.list([base32], fields, null, currency, null, null, 0, 1);
        const token = result?.list?.shift();
        const isRegistered = token !== undefined;
        const toolkit = tokenTool || confluxSDK;
        const tokenInfo = await toolkit.getToken(base32);
        let transferType;
        let transferCount;
        if(isRegistered === false){
            const hex40 = await Hex40Map.findOne({ where: { hex: format.hexAddress(base32).substr(2) } });
            const hex40id = hex40?.id;
            if (hex40id) {
                const transferInfo = await TokenQuery.getTransferType(hex40id);
                transferType = transferInfo?.transferType;
                transferCount = transferInfo?.transferCount || 0;
            }
        }
        const totalSupply = await toolkit.getTokenTotalSupply(base32);
        let holderIncreasePercent = 0;
        let holderIncreaseError;
        if (address && token) {
            // query token detail page, should has only one record
            [holderIncreasePercent] = await DailyToken.calcRecentIncrease(token.hex40id).catch((err)=>{
                holderIncreaseError = err.toLocaleString()
                return [0]
            })
        }
        return lodash.defaults(token, { address, base32, name: tokenInfo.name, symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals, isRegistered, transferType, totalSupply , transferCount, holderIncreasePercent});
    }

    public async search(name, currency, skip: number = 0, limit: number = 10) {
        if(!name){
            return {total: 0, list: [], contractTotal: 0, contractList: []};
        }

        // fields
        const options: any = {raw: true};
        options.attributes = [['base32', 'address'],
            'name',
            'symbol',
            'decimals',
            'totalSupply',
            ['holder', 'holderCount'],
            ['transfer', 'transferCount'],
            ['type', 'transferType'],
            'icon',
            'price',
            'quoteUrl',
            'totalPrice',
            'priceCNY',
            'priceUSD',
            'priceGBP',
            'priceKRW',
            'priceRUB',
            'priceEUR',
            'totalPriceCNY',
            'totalPriceUSD',
            'totalPriceGBP',
            'totalPriceKRW',
            'totalPriceRUB',
            'totalPriceEUR',
        ];

        // query
        const query: any = {};
        if(name){
            const conditionArray = [];
            conditionArray.push({name: { [Op.like]: `%${name}%`}});
            conditionArray.push({symbol: { [Op.like]: `%${name}%`}});
            query[Op.or] = conditionArray;
            options.where = query;
        }

        // order
        options.order = [['totalPrice', 'DESC'], ['createdAt', 'ASC']];

        // page
        options.offset = skip;
        options.limit = limit;

        // process
        const page = await Token.findAndCountAll(options)
        const list = [];
        const addressSet = new Set<string>();
        currency = '';
        if(page && page.rows){
            page.rows.forEach( row => {
                row['price'] = row[`price${currency}`];
                row['totalPrice'] = row[`totalPrice${currency}`];
                if(row['icon']) {
                    row['icon'] = decodeUtf8(row['icon']);
                }
                list.push(row);
                addressSet.add(row['address']);
            });
        }

        // query contract
        const contractInfoArray = await Contract.findAll({
            attributes: ['base32', 'name', 'epoch', 'hex40id'],
            where: {name: { [Op.like]: `%${name}%`}}, order: [['epoch', 'ASC']], raw: true
        });
        const contractInfoMap = new Map();
        contractInfoArray?.filter(item => !addressSet.has(item['base32'])).forEach(item=>{
            contractInfoMap.set(item.hex40id , { address: item['base32'], name: item['name'], epoch: item['epoch'] });
        })
        let contractList = [];
        contractInfoMap?.forEach(value => contractList.push(value));
        contractList = contractList.length > 10 ? contractList.slice(0, 10) : contractList;

        return { total: list.length, list, contractTotal: contractList.length, contractList };
    }

    public async list(addressArray, fields, transferType = undefined, currency = undefined, orderBy = undefined,
                      reverse = undefined, skip: number = 0, limit: number = 10) {
        const options: any = {};
        // fields
        let attributes: any = [['base32', 'address'],
            'hex40id',
            'name',
            'symbol',
            'decimals',
            'totalSupply','fetchBalance',
            ['holder', 'holderCount'],
            ['transfer', 'transferCount'],
            ['type', 'transferType']
        ];
        if(fields && fields.length>0) {
            if (!lodash.isArray(fields)) {
                fields = [fields];
            }
            const set = new Set(fields);
            if (set.has('icon')) {
                attributes.push('icon');
            }
            if (set.has('price')) {
                attributes.push('price');
                attributes.push('quoteUrl');
                attributes.push('totalPrice');
                attributes.push('priceCNY');
                attributes.push('priceUSD');
                attributes.push('priceGBP');
                attributes.push('priceKRW');
                attributes.push('priceRUB');
                attributes.push('priceEUR');
                attributes.push('totalPriceCNY');
                attributes.push('totalPriceUSD');
                attributes.push('totalPriceGBP');
                attributes.push('totalPriceKRW');
                attributes.push('totalPriceRUB');
                attributes.push('totalPriceEUR');
            }
        }
        options.attributes = attributes;

        // query
        const query: any = {};
        if(transferType){
            query.type = transferType;
        }
        if(addressArray?.length){
            if (!lodash.isArray(addressArray)) {
                addressArray = [addressArray];
            }
            query.base32 = {[Op.in]: addressArray};
        }
        options.where = query;

        // page
        options.offset = skip;
        options.limit = limit;
        // order by
        let order: any;
        currency = '';
        if(orderBy){
            if(orderBy === 'transferCount'){
                orderBy = 'transfer';
            }
            if(orderBy === 'holderCount'){
                orderBy = 'holder';
            }
            if(orderBy === 'price'){
                orderBy = `price${currency}`;
            }
            if(orderBy === 'totalPrice'){
                orderBy = `totalPrice${currency}`;
            }
            const orderItem = [];
            orderItem.push(orderBy);
            orderItem.push(reverse === 'true' ? 'DESC' : 'ASC');
            order = [];
            order.push(orderItem);
            options.order = order;
        }
        const page = await Token.findAndCountAll(options)
        const list = [];
        if(page && page.rows){
            page.rows.forEach( item => {
                const row = item.toJSON();
                row['price'] = row[`price${currency}`];
                row['totalPrice'] = row[`totalPrice${currency}`];
                if(row['icon']) {
                    row['icon'] = decodeUtf8(row['icon']);
                }
                row['transferType'] = (row['transferType'] || '').toUpperCase();
                list.push(row);
            });
        }
        return { total: page?.count || 0, list };
    }

    public async listRegisterAddress() {
        const{ logger } = this.app;

        const options: any = {attributes: ['base32', 'hex40id'], raw: true};
        // logger?.info({src: `TokenQuery.listRegisterAddress.rdb`, options: `${JSON.stringify(options)}`});
        const tokenList = await Token.findAll(options)
        // logger?.info({src: `TokenQuery.listRegisterAddress.rdb`, tokenList: `${JSON.stringify(tokenList)}`});
        const list = [];
        if(tokenList){
            tokenList.forEach( item => {
                const hex40 = format.hexAddress(item.base32);
                list.push(hex40);
            });
        }
        // logger?.info({src: `TokenQuery.listRegisterAddress.rdb`, list: `${JSON.stringify(list)}`});
        return { total: list.length, list };
    }

    private static async getTransferType(addressId) {
        const [erc20Record, erc721Record, erc777Record, erc1155Record] = await Promise.all([
            Erc20Transfer.count({ where: { contractId: addressId }}),
            Erc721Transfer.count({ where: { contractId: addressId }}),
            Erc777Transfer.count({ where: { contractId: addressId }}),
            Erc1155Transfer.count({ where: { contractId: addressId }}),
        ]);
        if(erc20Record) return  {transferType: CONST.TRANSFER_TYPE.ERC20, transferCount: erc20Record};
        if(erc721Record) return {transferType: CONST.TRANSFER_TYPE.ERC721, transferCount: erc721Record};
        if(erc777Record) return {transferType: CONST.TRANSFER_TYPE.ERC777, transferCount: erc777Record};
        if(erc1155Record) return {transferType: CONST.TRANSFER_TYPE.ERC1155, transferCount: erc1155Record};
    }
}
