// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op} from 'sequelize';
import {DailyToken, Token} from "../model/Token";
import {decodeUtf8} from "./tool/StringTool";
import {Hex40Map} from "../model/HexMap";
import {toBase32} from "./tool/AddressTool";
import {Contract} from "../model/Contract";
import {ContractVerify} from "../model/ContractVerify";
import {makeId} from "../model/HexMap";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc777Transfer} from "../model/Erc777Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {TokenSecurityAudit} from "../model/TokenSecurityAudit";

const lodash = require('lodash');
const CONST = require('./common/constant');

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
            'price', 'totalPrice', 'quoteUrl', 'iconUrl', 'fetchBalance'];
        if (lodash.includes(fields, 'icon')) {
            attributes.push('icon');
        }
        options.attributes = attributes;
        // where
        const where: any = {auditResult: true};
        if (addressArray?.length) {
            addressArray = addressArray.map(item => toBase32(item));
            where.base32 = {[Op.in]: addressArray};
        }  if (name) {
            where[Op.or] = [{name: {[Op.like]: `%${name}%`}}, {symbol: {[Op.like]: `%${name}%`}}];
        } else {
            if (transferType) {
                where.type = transferType;
            }
        }
        options.where = where;
        // order
        if(name){
            options.order = [['totalPrice', 'DESC'], ['createdAt', 'ASC']];
        } else if (orderBy) {
            if (orderBy === 'transferCount') {
                orderBy = 'transfer';
            }
            if (orderBy === 'holderCount') {
                orderBy = 'holder';
            }
            if (orderBy === 'price') {
                orderBy = `price`;
            }
            if (orderBy === 'totalPrice') {
                orderBy = `totalPrice`;
            }
            options.order = [[orderBy, reverse === 'true' ? 'DESC' : 'ASC']];
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
        if (addressArray) {// add unregistered tokens
            const unregisteredTokens = addressArray.filter(address => !lodash.includes(registeredTokens, address));
            const tokens = await Promise.all(unregisteredTokens.map(item => this.getTokenInfo(item)));
            if (tokens?.length) {
                list = [...list, ...tokens];
            }
            count = list.length;
        } else if(name){// add contracts for unmatched token
            const where: any = {name: {[Op.like]: `%${name}%`}};
            if(registeredTokens?.length) where.base32 = {[Op.notIn]: registeredTokens};
            contractList = await Contract.findAll({ offset: 0, limit: 10, raw: true,
                attributes: [['base32', 'address'], 'name', 'epoch'], where, order: [['epoch', 'ASC']]
            });
        }
        // add security audit
        await this.getAuditInfo(list);

        return {total: count, list, contractTotal: contractList?.length, contractList};
    }

    public async listAddress(where: object = {}) {
        const options: any = {attributes: ['base32'], raw: true};
        if (where && Object.keys(where).length) {
            options.where = lodash.defaults(options.where, where);
        }

        const tokenArray = await Token.findAll(options)
        const addressArray = tokenArray.map(item => item.base32);

        return {total: addressArray.length, list: addressArray};
    }

    public async audit({
       address, verify, audit, sponsor, zeroAdmin, cexBinance, cexHuobi, cexOKEx, dexMoonSwap, trackCoinMarketCap
    }): Promise<boolean> {
        const base32 = toBase32(address);
        const hex40id = (await makeId(address)).id;

        const securityAuditDb: TokenSecurityAudit = await TokenSecurityAudit.findOne({where: {base32}, raw: true});
        let sa = lodash.defaults({}, {
            hex40id, base32, verify, audit, sponsor, zeroAdmin, cexBinance, cexHuobi,
            cexOKEx, dexMoonSwap, trackCoinMarketCap
        });
        if (securityAuditDb) {
            sa = lodash.assign(securityAuditDb, sa, {updatedAt: new Date()});
            await TokenSecurityAudit.update(sa, {where: {id: securityAuditDb.id}});
        } else {
            await TokenSecurityAudit.add(sa);
        }

        return Promise.resolve(true);
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
}
