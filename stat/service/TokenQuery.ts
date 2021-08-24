// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {DailyToken, Token} from "../model/Token";
const lodash = require('lodash');
import {decodeUtf8} from "./tool/StringTool";
const {Hex40Map} = require("../model/HexMap");
import {toBase32} from "./tool/AddressTool";
import {Contract} from "../model/Contract";
import {isCustodianToken} from "./tool/TokenTool";
import {ContractVerify} from "../model/ContractVerify";
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
        const response = await this.list([address], fields, null, currency, null, null, 0, 1);
        const token = (response.list)[0];

        token.holderIncreasePercent = 0;
        if(token.isRegistered){
            const [increaseRatio] = await DailyToken.calcRecentIncrease(token.hex40id).catch((err)=>{ return [0] });
            token.holderIncreasePercent = increaseRatio;
        }
        token.isCustodianToken = await isCustodianToken(token.address)

        return token;
    }

    public async search(name, currency, skip: number = 0, limit: number = 10) {
        if(!name){
            return {total: 0, list: [], contractTotal: 0, contractList: []};
        }
        // fields
        const options: any = { offset: skip, limit, raw: true};
        currency = '';// close fiat selection
        let attributes: any = [['base32', 'address'],
            'name',
            'symbol',
            'decimals',
            'granularity',
            'totalSupply',
            ['holder', 'holderCount'],
            ['transfer', 'transferCount'],
            ['type', 'transferType'],
            ['iconUrl', 'icon'],
            'price',
            'totalPrice',
            'quoteUrl',
        ];
        if (currency.length) {
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
        options.attributes = attributes;

        // where
        const query: any = {auditResult: true};
        if(name){
            const conditionArray = [];
            conditionArray.push({name: { [Op.like]: `%${name}%`}});
            conditionArray.push({symbol: { [Op.like]: `%${name}%`}});
            query[Op.or] = conditionArray;
        }
        options.where = query;

        // order by
        options.order = [['totalPrice', 'DESC'], ['createdAt', 'ASC']];

        // query
        const page = await Token.findAndCountAll(options)
        const list = [];
        const addressSet = new Set<string>();
        if(page && page.rows){
            page.rows.forEach( row => {
                row['price'] = row[`price${currency}`];
                row['totalPrice'] = row[`totalPrice${currency}`];
                row['icon'] = row['icon'] ? '/stat/' + row['icon'] : undefined
                list.push(row);
                addressSet.add(row['address']);
            });
        }

        // query contract
        const contractArray = await Contract.findAll({
            attributes: ['base32', 'name', 'epoch', 'hex40id'],
            where: {name: { [Op.like]: `%${name}%`}}, order: [['epoch', 'ASC']], offset: 0, limit: 10, raw: true
        });
        const contractMap = new Map();
        contractArray?.filter(item => !addressSet.has(item['base32'])).forEach(item=>{
            contractMap.set(item.hex40id , { address: item['base32'], name: item['name'], epoch: item['epoch'] });
        })
        let contractList = [];
        contractMap?.forEach(value => contractList.push(value));
        contractList = contractList.length > 10 ? contractList.slice(0, 10) : contractList;

        return { total: list.length, list, contractTotal: contractList.length, contractList };
    }

    public async list(addressArray, fields, transferType = undefined, currency = undefined, orderBy = undefined,
                      reverse = undefined, skip: number = 0, limit: number = 10) {
        const{ logger } = this.app;
        const options: any = { offset: skip, limit, raw: true};
        // fields
        let attributes: any = [['base32', 'address'],
            'hex40id',
            'name',
            'symbol', 'fetchBalance',
            'decimals',
            'granularity',
            'totalSupply','fetchBalance',
            // ['iconUrl','icon'],
            ['holder', 'holderCount'],
            ['transfer', 'transferCount'],
            ['type', 'transferType'],
            'price',
            'totalPrice',
            'quoteUrl',
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

        // where
        const query: any = {auditResult: true};
        if(transferType){
            query.type = transferType;
        }
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

        //query
        const [page, verified] = await Promise.all([
            Token.findAndCountAll(options),
            ContractVerify.findAll({attributes:['base32'],
                where: {verifyResult: true}
            }).then(arr=>arr.map(t=>t.base32)).then(arr=>new Set(arr))
        ])
        let list = [];
        if(page && page.rows){
            page.rows.forEach( row => {
                row['price'] = row[`price${currency}`];
                row['totalPrice'] = row[`totalPrice${currency}`];
                row['transferType'] = (row['transferType'] || '').toUpperCase();
                row['isRegistered'] = true;
                if(row['icon']) {
                    row['icon'] = decodeUtf8(row['icon']);
                }
                // row['icon'] = row['icon'] ? '/stat/' + row['icon'] : undefined;
                row['verified'] = verified.has(row['address']);
                list.push(row);
            });
        }

        // token unregistered
        let total = page?.count || 0;
        if(addressArray){
            const registered = new Set(list.map(item => item.address));
            const unregistered = addressArray.filter(item => !registered.has(item));
            const unregisteredToken = await Promise.all(unregistered.map(item => this.getTokenUnregistered(item)));
            if(unregisteredToken.length){
                list = [...list, ...unregisteredToken];
            }
            total = list.length;
        }

        return { total, list };
    }

    public async listAddress(where: object = {} ) {
        const options: any = { attributes: ['base32', 'hex40id'], where: {auditResult: true}, raw: true };
        if(where && Object.keys(where).length){
            options.where = lodash.defaults(options.where, where);
        }

        const tokenArray = await Token.findAll(options)
        const addressArray = tokenArray.map( item => item.base32);

        return { total: addressArray.length, list: addressArray };
    }

    private async getTokenUnregistered(base32){
        const {
            app: { tokenTool, confluxSDK },
        } = this;

        const toolkit = tokenTool || confluxSDK;
        const tokenBasic = await toolkit.getToken(base32);
        const totalSupply = await toolkit.getTokenTotalSupply(base32);
        const hex40 = await Hex40Map.findOne({ where: { hex: format.hexAddress(base32).substr(2) } });
        const transferInfo = await TokenQuery.getTransferType(hex40?.id);
        return lodash.defaults(tokenBasic, { totalSupply }, transferInfo,
            { isRegistered: false, holderIncreasePercent: 0 });
    }

    private static async getTransferType(addressId) {
        if(addressId === undefined) return { transferCount: 0 };
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
