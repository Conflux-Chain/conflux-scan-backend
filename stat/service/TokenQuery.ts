// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op, QueryTypes, Sequelize} from 'sequelize';
import {DailyToken, Token} from "../model/Token";
import {decodeUtf8} from "./tool/StringTool";
import {Hex40Map, makeId} from "../model/HexMap";
import {toBase32} from "./tool/AddressTool";
import {Contract} from "../model/Contract";
import {ContractVerify} from "../model/ContractVerify";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc777Transfer} from "../model/Erc777Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {TokenSecurityAudit} from "../model/TokenSecurityAudit";
import {TokenBalance} from "../model/Balance";
import {StatApp} from "../StatApp";

const lodash = require('lodash');
const CONST = require('./common/constant');
const REGEX_URL = /^(https?:\/\/(([a-zA-Z0-9]+-?)+[a-zA-Z0-9]+\.)+[a-zA-Z]+)(:\d+)?(\/.*)?(\?.*)?(#.*)?$/;

export class TokenQuery {
    protected app: any;

    constructor(app: any) {
        this.app = app;
    }

    public async query({address}) {
        const response = await this.list({addressArray: [address]});
        const token = (response.list)[0] || {};

        if (token.isRegistered) {
            const [increaseRatio] = await DailyToken.calcRecentIncrease(token.hex40id).catch(() => {
                return [0]
            });
            token.holderIncreasePercent = increaseRatio;
        }
        return token;
    }

    public async list({addressArray, name, transferType, fields, orderBy, reverse, skip = 0, limit = 10
      }: { addressArray?: string[], name?: string, transferType?: string, fields?: string[], orderBy?: string,
        reverse?: boolean | string, skip?: number, limit?: number
    }) {
        // fields
        const options: any = {raw: true};
        let attributes: any = ['hex40id', ['base32', 'address'],
            'name', 'symbol', 'decimals', 'granularity', 'totalSupply',
            ['type', 'transferType'], ['holder', 'holderCount'], ['transfer', 'transferCount'],
            'price', 'totalPrice', 'quoteUrl', 'iconUrl', 'website', 'securityCredits'];
        if (lodash.includes(fields, 'icon')) {
            attributes.push('icon');
        }
        options.attributes = attributes;
        // where
        const where: any = {auditResult: true};
        if (name) {
            where[Op.or] = [{name: {[Op.like]: `%${name}%`}}, {symbol: {[Op.like]: `%${name}%`}}];
        } else if (addressArray?.length) {
            addressArray = addressArray.map(item => toBase32(item));
            where.base32 = {[Op.in]: addressArray};
        } else {
            if (transferType) {
                where.type = transferType;
            }
        }
        options.where = where;
        // order
        if (name) {
            options.order = [['totalPrice', 'DESC'], ['createdAt', 'ASC']];
        } else if (addressArray?.length) {// NO-OP
        } else {
            if (orderBy) {
                const rev = reverse === 'true' ? 'DESC' : 'ASC';
                if (orderBy === 'totalPrice')
                    options.order = [Sequelize.fn('ISNULL', Sequelize.col('totalPrice')),
                        ['totalPrice', rev], ['securityCredits', rev], ['transfer', rev]];
                if (orderBy === 'securityCredits') options.order = [['securityCredits', rev], ['transfer', rev]];
                if (orderBy === 'transferCount') options.order = [['transfer', rev]];
                if (orderBy === 'price')
                    options.order = [Sequelize.fn('ISNULL', Sequelize.col('price')), ['price', rev]];
                if (orderBy === 'holderCount') options.order = [['holder', rev]];
            }
        }
        //query
        let rawList;
        let count;
        if (addressArray) {
            rawList = await Token.findAll(options);
            count = rawList?.length || 0;
        } else {
            options.offset = skip;
            options.limit = limit;
            const page = await Token.findAndCountAll(options);
            rawList = page?.rows;
            count = page?.count;
        }
        let list = [];
        let registeredTokens;
        if (rawList) {
            registeredTokens = rawList.map(item => item.address);
            const verifiedTokens = await ContractVerify.findAll({
                attributes: ['base32'],
                where: {verifyResult: true, base32: {[Op.in]: registeredTokens}}
            }).then(arr => arr.map(t => t.base32));
            rawList.forEach(row => {
                row['transferType'] = lodash.toUpper(row['transferType']);
                if (lodash.includes(fields, 'icon')) {
                    row['icon'] = row['icon'] ? decodeUtf8(row['icon']) : undefined;
                }
                row['isRegistered'] = true;
                row['verified'] = lodash.includes(verifiedTokens, row['address']);
                list.push(row);
            });
        }
        // add additional info
        let contractList;
        if(name){// add contracts for unmatched token
            const where: any = {name: {[Op.like]: `%${name}%`}};
            if(registeredTokens?.length) where.base32 = {[Op.notIn]: registeredTokens};
            contractList = await Contract.findAll({ offset: 0, limit: 10, raw: true,
                attributes: [['base32', 'address'], 'name', 'epoch'], where, order: [['epoch', 'ASC']]
            });
        } else if (addressArray) {// add unregistered tokens
            const unregisteredTokens = addressArray.filter(address => !lodash.includes(registeredTokens, address));
            const tokens = await Promise.all(unregisteredTokens.map(item => this.getTokenInfo(item)));
            if (tokens?.length) {
                list = [...list, ...tokens];
            }
            count = list.length;
        }
        // add security audit
        await this.getAuditInfo(list);

        return {total: count, list, contractTotal: contractList?.length, contractList};
    }

    public async listLatest({accountAddress, transferType, latestTransfer = 10000}
       : {accountAddress: string, transferType: string, latestTransfer?: number
    }){
        const {
            app: {sequelize},
        } = this;

        const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(accountAddress).substr(2)}});
        if(!hex40) return [];
        const addressId = hex40?.id
        let tableName;
        if(transferType === CONST.TRANSFER_TYPE.ERC20){
            tableName = 'address_erc20_transfer';
        } else if(transferType === CONST.TRANSFER_TYPE.ERC721){
            tableName = 'address_erc721transfer';
        } else if(transferType === CONST.TRANSFER_TYPE.ERC1155){
            tableName = 'address_erc1155transfer';
        } else {
            return [];
        }
        if(latestTransfer <= 0 || latestTransfer > 10000) return [];

        const sql = `select hex from hex40 where id in (select distinct(contractId) from ( select contractId 
            from ${tableName} where addressId = ${addressId} order by createdAt desc limit ${latestTransfer}) tmp);`;
        const list = await sequelize.query(sql, {type: QueryTypes.SELECT, logging: console.log });
        const addressArray = list.map(item=> format.address(`0x${item.hex}`, StatApp.networkId));

        const response = await this.list({addressArray});
        let tokenArray = response.list.map(token => lodash.pick(token, ['address', 'name', 'symbol', 'iconUrl']));
        tokenArray = lodash.sortBy(tokenArray, item => lodash.toUpper(item.name));
        return {total: response.total, list: tokenArray};
    }

    static  async listAddress({ accountAddress, where = {}
    }:{ accountAddress: string, where?: object
    }) {

        let tokenArray;
        const options: any = { attributes: ['base32'], where: { auditResult: true }, raw: true };
        if(accountAddress){
            const hex40 = await Hex40Map.findOne({where:{hex:format.hexAddress(accountAddress).substr(2)}});
            if(!hex40) return { total: 0, list: [] };
            const addressId = hex40.id;

            const hexIdArray = [];
            await TokenBalance.findAll({attributes: ['contractId'], where: {addressId}})
                .then(balanceArray => balanceArray?.forEach(balance => hexIdArray.push(balance.contractId)));
            await Promise.all(['address_erc20_transfer', 'address_erc721transfer', 'address_erc1155transfer']
                .map(tableName => {
                    TokenBalance.sequelize.query(`select distinct(contractId) from ( select contractId from ${tableName} 
                        where addressId = ${addressId} order by createdAt desc limit 10) tmp;`,
                        {type: QueryTypes.SELECT, logging: console.log})
                        .then(transfers => transfers?.forEach(transfer =>
                            hexIdArray.push(transfer["contractId"])));
                }));
            if(hexIdArray.length === 0) return { total: 0, list: [] };
            where = {hex40id: {[Op.in]: hexIdArray}};
        }

        options.where = lodash.defaults(options.where, where);
        tokenArray = await Token.findAll(options);
        const addressArray = tokenArray.map(item => item.base32);

        return {total: addressArray.length, list: addressArray};
    }

    public async audit({address, audit, sponsor, cexBinance, cexHuobi, cexOKEx, dexMoonSwap, trackCoinMarketCap,
        blackList = false
    }: { address: string, audit?: boolean, sponsor?: boolean, cexBinance?: string, cexHuobi?: string, cexOKEx?: string,
        dexMoonSwap?: string, trackCoinMarketCap?: string, blackList?: boolean
    }): Promise<object> {
        try {
            const base32 = toBase32(address);
            const token = await Token.findOne({attributes: ['id', 'hex40id'], where: {base32}});
            if(!token){
                return Promise.resolve({code: 9999, msg: `token:${base32} not exist`});
            }

            const { zeroAdmin, verify } = await this.getAuditBasic(base32);
            const a = lodash.defaults({updatedAt: new Date()}, { hex40id: token.hex40id, base32, verify, audit, sponsor,
                zeroAdmin, cexBinance, cexHuobi, cexOKEx, dexMoonSwap, trackCoinMarketCap
            });
            await TokenSecurityAudit.upsert(a);

            const securityCredits = await this.calSecurityCredits(base32);
            const t = blackList ? { securityCredits, auditResult: !blackList } : { securityCredits };
            await Token.update(t,{where: {id: token.id}});

            return Promise.resolve({code: 0, msg: `token:${address} audit success`});
        } catch (e) {
            console.log(`token-audit fail, address:${address}`, e);
            return Promise.resolve({code: 9999, msg: `token:${address} audit fail`});
        }
    }

    private async getTokenInfo(base32) {
        const {
            app: {tokenTool, confluxSDK},
        } = this;

        const hex40 = await Hex40Map.findOne({where: {hex: format.hexAddress(base32).substr(2)}});
        const toolkit = tokenTool || confluxSDK;
        const [tokenBasic, totalSupply, transferInfo] = await Promise.all([
            toolkit.getToken(base32),
            toolkit.getTokenTotalSupply(base32),
            TokenQuery.getTransferInfo(hex40?.id),
        ]);

        return lodash.defaults(tokenBasic, {totalSupply}, transferInfo,
            {isRegistered: false, holderIncreasePercent: 0});
    }

    private static async getTransferInfo(addressId) {
        if (addressId === undefined)
            return {transferCount: 0};

        const [erc20Count, erc721Count, erc777Count, erc1155Count] = await Promise.all([
            Erc20Transfer.count({where: {contractId: addressId}}),
            Erc721Transfer.count({where: {contractId: addressId}}),
            Erc777Transfer.count({where: {contractId: addressId}}),
            Erc1155Transfer.count({where: {contractId: addressId}}),
        ]);

        if (erc20Count) return {transferType: CONST.TRANSFER_TYPE.ERC20, transferCount: erc20Count};
        if (erc721Count) return {transferType: CONST.TRANSFER_TYPE.ERC721, transferCount: erc721Count};
        if (erc777Count) return {transferType: CONST.TRANSFER_TYPE.ERC777, transferCount: erc777Count};
        if (erc1155Count) return {transferType: CONST.TRANSFER_TYPE.ERC1155, transferCount: erc1155Count};
    }

    private async getAuditBasic(base32): Promise<{ zeroAdmin: boolean, verify: boolean }>{
        const { cfx } = this.app;
        const account = await cfx.getAccount(base32);
        const zeroAdmin = account?.admin && (format.hexAddress(account.admin) === CONST.ZERO_ADDRESS) ? true : false;

        const verifyInfo =  await ContractVerify.findOne({where: {base32, verifyResult: true}});
        const verify = verifyInfo?.verifyResult ? true : false;

        return Promise.resolve({zeroAdmin, verify});
    }

    private async getAuditInfo(tokenArray) {
        const addressArray = tokenArray?.map(item => item.address);
        if (!addressArray?.length) {
            return;
        }
        const securityAuditArray = await TokenSecurityAudit.findAll({where: {base32: {[Op.in]: addressArray}}});
        const securityAuditMap = lodash.keyBy(securityAuditArray, 'base32');
        tokenArray.forEach(item => {
            const securityAudit = securityAuditMap[item.address];
            item.securityAudit = {
                verify: securityAudit?.verify ? 1 : 0,
                audit: securityAudit?.audit ? 1 : 0,
                sponsor: securityAudit?.sponsor ? 1 : 0,
                zeroAdmin: securityAudit?.zeroAdmin ? 1 : 0,
                cex: {
                    binance: securityAudit?.cexBinance,
                    huobi: securityAudit?.cexHuobi,
                    okex: securityAudit?.cexOKEx,
                },
                dex: {
                    moonswap: securityAudit?.dexMoonSwap,
                },
                track: {
                    coinMarketCap: securityAudit?.trackCoinMarketCap,
                }
            };
        });
    }

    private async calSecurityCredits(base32): Promise<number> {
        const auditDb = await TokenSecurityAudit.findOne({where: {base32}, raw: true});
        const {
            verify, audit, sponsor, zeroAdmin, cexBinance, cexHuobi, cexOKEx, dexMoonSwap, trackCoinMarketCap
        } = auditDb;

        const auditCreditArray = [verify, audit, sponsor, zeroAdmin];
        const cexCreditArray = [cexBinance, cexHuobi, cexOKEx];
        const dexCreditArray = [dexMoonSwap];
        const trackCreditArray = [trackCoinMarketCap];

        let credits = 0;
        credits = credits + auditCreditArray.filter(Boolean).length;
        credits = credits + (cexCreditArray.filter(item => item?.trim()?.match(REGEX_URL)).length > 0 ? 1 : 0);
        credits = credits + (dexCreditArray.filter(item => item?.trim()?.match(REGEX_URL)).length > 0 ? 1 : 0);
        credits = credits + (trackCreditArray.filter(item => item?.trim()?.match(REGEX_URL)).length > 0 ? 1 : 0);
        return Promise.resolve(credits);
    }
}
