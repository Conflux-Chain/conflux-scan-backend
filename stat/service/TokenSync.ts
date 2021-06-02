// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op, Sequelize} from 'sequelize';
import {SyncBase, SyncData} from "./SyncBase";
import {DailyToken, Token} from "../model/Token";
import {makeId} from "../model/HexMap";
const addressSdk = require('js-conflux-sdk/src/util/address')
const lodash = require('lodash');
const superagent = require('superagent');
import {decodeUtf8} from "./tool/StringTool";
const {Hex40Map} = require("../model/HexMap");
import {StatApp} from "../StatApp";
import {FullMinerBlock} from "../model/FullMinerBlock";
const {Erc20Transfer} = require("../model/Erc20Transfer");
const {Erc721Transfer} = require("../model/Erc721Transfer");
const {Erc777Transfer} = require("../model/Erc777Transfer");
const {Erc1155Transfer} = require("../model/Erc1155Transfer");
const CONST = require('./common/constant');

export class TokenSync extends SyncBase{
    protected app: StatApp;
    private sequelize: Sequelize;
    private config: {scanApiUrl:string};
    private pageSize: number = 10;

    constructor(app: any) {
        super(app);
        this.app = app;
        this.sequelize = app.sequelize;
        this.config = app.config
    }

    //--------------------------------query-----------------------------------
    public async listTokenByName(name, currency, skip: number = 0, limit: number = 10) {
        // fields
        const options: any = {};
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
            if(name.toLocaleUpperCase().startsWith('CFX')){
                const simpleAddress = addressSdk.simplifyCfxAddress(name);
                conditionArray.push({base32: simpleAddress});
            }
            query[Op.or] = conditionArray;
            options.where = query;
        }

        // page
        options.offset = skip;
        options.limit = limit;

        // process
        const page = await Token.findAndCountAll(options)
        const list = [];
        currency = '';
        if(page && page.rows){
            page.rows.forEach( item => {
                const row = item.toJSON();
                row['price'] = row[`price${currency}`];
                row['totalPrice'] = row[`totalPrice${currency}`];
                if(row['icon']) {
                    row['icon'] = decodeUtf8(row['icon']);
                }
                list.push(row);
            });
        }
        return { total: page?.count || 0, list };
    }

    public async queryTokenByAddress(address, fields, currency) {
        const result = await this.listToken(fields, null, currency, null, null, 0, 1, address);
        const token = result?.list?.shift();
        const isRegistered = token !== undefined;
        const tokenInfo = await this.app.tokenTool.getToken(address);

        let transferType;
        const hex40 = await Hex40Map.findOne({ where: { hex: format.hexAddress(address).substr(2) } });
        const addressId = hex40?.id;
        if (addressId) {
            transferType = await TokenSync.getTransferType(addressId);
        }
        const totalSupply = await this.app.tokenTool.getTokenTotalSupply(address);

        return lodash.defaults(token, { address, name: tokenInfo.name, symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals, isRegistered, transferType, totalSupply });
    }

    private static async getTransferType(addressId) {
        const [erc20Record, erc721Record, erc777Record, erc1155Record] = await Promise.all([
            Erc20Transfer.findOne({ attributes: ['contractId'], where: { contractId: addressId }, limit: 1 }),
            Erc721Transfer.findOne({ attributes: ['contractId'], where: { contractId: addressId }, limit: 1 }),
            Erc777Transfer.findOne({ attributes: ['contractId'], where: { contractId: addressId }, limit: 1 }),
            Erc1155Transfer.findOne({ attributes: ['contractId'], where: { contractId: addressId }, limit: 1 }),
        ]);
        if(erc20Record) return  CONST.TRANSFER_TYPE.ERC20;
        if(erc721Record) return CONST.TRANSFER_TYPE.ERC721;
        if(erc777Record) return CONST.TRANSFER_TYPE.ERC777;
        if(erc1155Record) return CONST.TRANSFER_TYPE.ERC1155;
    }

    public async listToken(fields, transferType, currency, orderBy, reverse, skip: number = 0, limit: number = 10, address) {
        const options: any = {};
        // fields
        let attributes: any = [['base32', 'address'],
            'hex40id',
            'name',
            'symbol',
            'decimals',
            'totalSupply',
            ['holder', 'holderCount'],
            ['transfer', 'transferCount'],
            ['type', 'transferType']
        ];
        if(fields && fields.indexOf('icon') > 0){
            attributes.push('icon');
        }
        if(fields && fields.indexOf('price') > 0){
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
        options.attributes = attributes;

        // query
        const query: any = {};
        if(transferType){
            query.type = transferType;
        }
        if(address){
            query.base32 = address;
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
            if (address && page.rows[0]) {
                // query token detail page, should has only one record
                const [percent] = await DailyToken.calcRecentIncrease(page.rows[0].hex40id).catch((err)=>{
                    list[0]['holderIncreaseError'] = err.toLocaleString()
                    return [0]
                })
                list[0]['holderIncreasePercent'] = percent
            }
        }
        return { total: page?.count || 0, list };
    }

    //---------------------------sync from scan-api---------------------------
    private async syncFromScan() {
        let skip = 0;
        let total;
        let currPage = 1;
        do{
            let response = await this.getFromScan(skip, this.pageSize).catch(err=>{
                console.log(`error get from scan:`, err)
            });
            if(!response) return;
            total = total ? total : response.total;
            console.log('sync toke_list currPage======', currPage, ',skip======', skip, ',total======', total );

            const tokenList = response.list;
            for (const token of tokenList) {
                const base32 = addressSdk.simplifyCfxAddress(token.address);
                const dbToken: Token = await Token.findOne({where: {base32}});
                if(dbToken){
                    const t = lodash.assign(token, {type: token.transferType,
                        transfer: token.transferCount, updatedAt: Date.now()});
                    await dbToken.update(t, {where: {id: dbToken.id}});
                } else{
                    const hex40 = format.hexAddress(token.address);
                    const hexBean = await makeId(hex40);
                    const t = lodash.assign(token, {type: token.transferType,
                        transfer: token.transferCount, base32, hex40id: hexBean.id, holder: 0});
                    await Token.add(t);
                }
            }
            skip = (++currPage - 1) * this.pageSize ;
        } while (skip <= total);
    }

    private async getFromScan(skip: number = 0, limit: number = 10): Promise<{ total: number, list: any }>{
        const response = await superagent.get(`${this.config.scanApiUrl}/v1/token`)
            .query(`fields=transferCount%2Cicon%2Cprice%2CtotalPrice%2CquoteUrl%2CtransactionCount%2Cerc20TransferCount
            %2CmarketCapId%2CmoonDexSymbol%2CbinanceSymbol
            &skip=${skip}&limit=${limit}`)
            .timeout(60 * 1000);
        if (response.status !== 200) {
            console.log('sync toke_list fail:', JSON.stringify(response));
            return;
        }
        return response.body;
    }

    public async schedule() {
        const that = this;
        async function repeat() {
            await that.syncFromScan().catch(err=>{
                console.log(`sync toke_list fail: `, err);
            });
            const delay = 60;// in minutes
            setTimeout(repeat, delay * 60 *  1000);// 1hour interval
            console.log(`sync toke_list service in delay ${delay}min.`);
        }
        try {
            repeat().then().catch(err => {
                console.log(`schedule TokenSync fail:`, err)
            });
        } catch (err) {
            console.log(`catch error token sync:`, err)
        }
    }

    //----------------- implementation method from SyncBase ------------------
    async delDataFromDb(epochNumber, modelData) {
    }

    async getDataFromFullNode(epochNumber): Promise<SyncData> {
        return Promise.resolve(undefined);
    }

    async saveDataToDb(epochNumber, modelData) {
    }

    public async queryNextEpochFromDb(){
        let maxEpochNumber:number = await FullMinerBlock.max('epoch')
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    //---------------------- business method for token -----------------------
    async getAnnounceArray(epochNumber) {
        const {
            app: { tokenTool },
        } = this;

        const eventLogArray = await this.getLogs(epochNumber);
        return eventLogArray.map((eventLog) => tokenTool.decodeAnnounce(eventLog)).filter(Boolean);
    }

    private async getLogs(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const eventLogArray = await cfx.getLogs({fromEpoch: epochNumber, toEpoch: epochNumber});
        return eventLogArray.map((v) => this.parseEventLog(v));
    }

    private parseEventLog(eventLog) {
        eventLog.epochNumber = Number(eventLog.epochNumber);
        eventLog.address = format.hexAddress(eventLog.address);
        eventLog.transactionLogIndex = Number(eventLog.transactionLogIndex);
        return eventLog;
    }

    private async getMinerBlockArray(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber);
        const blockArray = await Promise.all(blockHashArray.map(async (hash) => {
            return await cfx.getBlockByHash(hash, false)
        }));
        const minerBlockArray = await Promise.all(blockArray.map(async (block: any, position) => {
            const hex40 = format.hexAddress(block.miner);
            const blockDt = new Date(block.timestamp * 1000);
            const hex40Id = (await makeId(hex40, undefined, {dt: blockDt})).id;
            return {minerId: hex40Id, epoch: block.epochNumber, position, createdAt: blockDt};
        }));
        const pivotBlock: any = blockArray[blockArray.length - 1];
        let pivotHash = pivotBlock.hash.substr(2);
        let parentHash = pivotBlock.parentHash.substr(2);

        return {
            parentHash,
            pivotHash,
            modelData: minerBlockArray,
        };
    }
}



