// @ts-ignore
import {format} from 'js-conflux-sdk';
import {Op, QueryTypes, Sequelize} from 'sequelize';
import {DailyToken, Token} from "../model/Token";
import {decodeTokenIcon} from "./tool/TokenTool";
import {formatToBase32, getAddrIdArray, Hex40Map} from "../model/HexMap";
import {Contract} from "../model/Contract";
import {Erc20Transfer, T_ADDRESS_ERC20TRANSFER} from "../model/Erc20Transfer";
import {Erc721Transfer, T_ADDRESS_ERC721_TRANSFER} from "../model/Erc721Transfer";
import {Erc1155Transfer, T_ADDRESS_ERC1155_TRANSFER} from "../model/Erc1155Transfer";
import {TokenSecurityAudit} from "../model/TokenSecurityAudit";
import {TokenBalance} from "../model/Balance";
import {fmtAddr, StatApp} from "../StatApp";
import {Desensitizer} from "./Desensitizer";
import {CONST} from "./common/constant"
import {NAME_TAG_SPLIT} from "./EpochSync";
import {Errors} from "./common/LogicError";
import {NameTag} from "../model/NameTag";
import {ConfigInstance, NoCoreSpace} from "../config/StatConfig";
import {BatchBalanceWatcher} from "./watcher/BatchBalanceWatcher";

const lodash = require('lodash');

export class TokenQuery {
    static wrappedCFXAddr: string;
    static wrappedBTCAddr: string;
    static wrappedCFX: Token;
    static wrappedBTC: Token;
    private app: any;

    constructor(app: any) {
        this.app = app;
        this.scheduleWrappedToken().then();
    }

    public async query({address}) {
        const {list} = await this.list({addresses: [address]});
        if (!list?.length) {
            return null;
        }

        const token = list[0];

        if (token.isRegistered) {
            const [increaseRatio] = await DailyToken.calcRecentIncrease(token.hex40id).catch(() => [0]);
            token.holderIncreasePercent = increaseRatio;
        }

        return token;
    }

    public async list(
        {
            addresses,
            name,
            transferType,
            fields,
            orderBy,
            reverse,
            showDestroyed = true,
            skip = 0,
            limit = 10,
        }: {
            addresses?: string[],
            name?: string,
            transferType?: string,
            fields?: string[],
            orderBy?: string,
            reverse?: boolean | string,
            showDestroyed?: boolean,
            skip?: number,
            limit?: number,
        }
    ) {
        const {
            app: {accountQuery, contractQuery, service},
        } = this;

        // fields
        const options: any = {raw: true};
        let attributes: any = ['hex40id', ['base32', 'address'],
            'name', 'symbol', 'decimals', 'granularity', 'totalSupply',
            ['type', 'transferType'], ['holder', 'holderCount'], ['transfer', 'transferCount'],
            'price', 'totalPrice', 'quoteUrl', 'iconUrl', 'website', 'ipfsGateway', 'securityCredits'];
        if (lodash.includes(fields, 'icon')) {
            attributes.push('icon');
        }
        options.attributes = attributes;

        // where
        const where: any = {auditResult: true};
        if (name) {
            where[Op.or] = [{name: {[Op.like]: `%${name}%`}}, {symbol: {[Op.like]: `%${name}%`}}];
        } else if (addresses?.length) {
            addresses = addresses.map(item => formatToBase32(item));
            where.base32 = {[Op.in]: addresses};
        } else {
            if (transferType) {
                where.type = transferType;
            }
            if (ConfigInstance.onlyStatActiveContract) {
                where.transfer = {[Op.gt]: 10};
            }
        }
        if (!showDestroyed) {
            where.destroyed = false;
        }
        options.where = where;

        // order
        if (name) {
            options.order = [['securityCredits', 'DESC'], ['transfer', 'DESC']];
            if (NoCoreSpace) {
                options.order = [['transfer', 'DESC']];
            }
        } else if (addresses?.length) {// NO-OP
        } else {
            if (orderBy) {
                if (NoCoreSpace) {
                    if (orderBy !== 'holderCount') {
                        orderBy = 'transferCount';
                    }
                }
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
        let total;
        if (addresses?.length) {
            delete options.where['auditResult'];
            if (ConfigInstance.onlyStatActiveContract) {
                // when exporting TX of an account, we may encounter too many tokens(ZG testnet).
                // restrict it in order to protect our system.
                options.limit = Math.min(100, options.limit ?? 100);
            }
            rawList = await Token.findAll(options);
            total = rawList?.length || 0;
        } else {
            options.offset = skip;
            options.limit = limit;
            const page = await Token.findAndCountAll(options);
            rawList = page?.rows;
            total = page?.count || 0;
        }

        // check result size
        if (rawList.length > 200) {
            const msg = `token list with bad size ${rawList.length}`;
            console.log(msg);
            console.log(`addresses`, addresses, 'name', name, 'limit', limit)
            throw new Errors.BizError(msg)
        }

        // build result
        let list = [];
        let detectedTokens;
        if (rawList) {
            detectedTokens = rawList.map(item => item.address);
            const verifiedTokens = await (contractQuery || service.contractQuery).listVerifyInBatch(detectedTokens)
                .then(list => list.map(item => item.address));
            rawList.forEach(row => {
                row['address'] = fmtAddr(row['address'], StatApp.networkId);
                row['transferType'] = lodash.toUpper(row['transferType']);
                row['verified'] = lodash.includes(verifiedTokens, row['address']);
                row['isRegistered'] = true;
                if (lodash.includes(fields, 'icon')) {
                    row['icon'] = row['icon'] ? decodeTokenIcon(row['icon']) : undefined;
                }
                list.push(row);
            });
        }

        // add additional info
        let contractList;
        let eoaList;
        if (name) {
            const where: any = {name: {[Op.like]: `%${name}%`}};
            if (detectedTokens?.length) where.base32 = {[Op.notIn]: detectedTokens};
            if (!showDestroyed) where.destroyed = false;

            // get contract info
            contractList = await Contract.findAll({
                offset: 0, limit: 10, raw: true,
                attributes: [['base32', 'address'], 'name', 'epoch'], where,
                order: [['epoch', 'ASC']],
            });
            contractList?.forEach(contract => {
                contract["address"] = fmtAddr(contract['address'], StatApp.networkId);
            });

            // get name tag info
            eoaList = await NameTag.findAll({
                attributes: [['base32', 'address'], 'nameTag', 'labels'],
                where: {nameTag: {[Op.like]: `%${name}%`}, eoa: true},
                order: [['epoch', 'ASC']],
                offset: 0,
                limit: 100,
                raw: true,
            });
            eoaList?.forEach(nameTag => {
                nameTag["address"] = fmtAddr(nameTag['address'], StatApp.networkId);
                if (nameTag?.labels) {
                    const hasCautionLabel = nameTag.labels.split(NAME_TAG_SPLIT)
                        .find(label => (accountQuery || service.accountQuery)?.cautionLabels.has(label));
                    nameTag.caution = hasCautionLabel ? 1 : 0;
                    delete nameTag.labels;
                }
            })
        } else {
            list.forEach(TokenQuery.mosaicToken);
        }

        // add security audit info
        await this.addSecurityAuditInfo(list);

        return {
            total,
            list,
            contractTotal: contractList?.length,
            contractList,
            eoaTotal: eoaList?.length,
            eoaList,
        };
    }

    private MAX_TRANSFERS_LATEST = 10000;

    public async listRecently(
        {
            owner,
            type,
        }: {
            owner: string,
            type: string,
        }
    ) {
        const hex40 = await Hex40Map.findOne({
            where: {hex: format.hexAddress(owner).substr(2)},
        });
        if (!hex40) {
            return [];
        }

        const tableNameConverter = {
            [CONST.TRANSFER_TYPE.ERC20]: T_ADDRESS_ERC20TRANSFER,
            [CONST.TRANSFER_TYPE.ERC721]: T_ADDRESS_ERC721_TRANSFER,
            [CONST.TRANSFER_TYPE.ERC721]: T_ADDRESS_ERC1155_TRANSFER,
        };
        const tableName = tableNameConverter[type];
        if (!tableName) {
            throw new Error("Transfer type not supported.")
        }

        const addresses = await Hex40Map.sequelize.query(`
            select hex from hex40 
            where id in (
                select distinct(contractId) from (
                    select contractId
                    from ${tableName}
                    where addressId = ${hex40.id} 
                    order by epoch desc 
                    limit ${this.MAX_TRANSFERS_LATEST}
                ) tmp
            )`, {
            type: QueryTypes.SELECT,
        }).then((items: any[]) => items.map(
            item => format.address(`0x${item.hex}`, StatApp.networkId)
        ));

        const {total, list: tokens} = await this.list({addresses});
        let list = tokens
            .filter(token => (token?.name?.trim()?.length > 0) && (token?.symbol?.trim()?.length > 0))
            .map(token => lodash.pick(token, ['address', 'name', 'symbol', 'iconUrl']));
        list = lodash.sortBy(list, item => lodash.toUpper(item.name));

        return {total, list};
    }

    static async listByAccount(
        {
            owner,
            types,
            skip = 0,
            limit = 100,
            addresses = [],
            maxOfAllType = 10000,
            withRealtimeBalance = false,
        }: {
            owner: string,
            types?: TokenType[],
            skip?: number,
            limit?: number,
            addresses?: string[],
            maxOfAllType?: number,
            withRealtimeBalance?: boolean
        }
    ) {
        const hex = await Hex40Map.findOne({where: {hex: format.hexAddress(owner).substr(2)}});
        if (!hex) {
            return {total: 0, list: []};
        }

        const addressId = hex.id;
        const token = await TokenBalance.findOne({
            where: {addressId}, order: [["updatedAt", "desc"]], offset: maxOfAllType, limit: 1
        });

        let cond = 'where auditResult=1 and destroyed=0';
        if(types?.length) {
            cond = `${cond} and (${types.map(type => `t.type = '${type.replace('CRC', 'ERC')}'`).join(' or ')})`;
        }

        const total = token ?  maxOfAllType : (await TokenBalance.sequelize.query(`
            select count(*) cntr
            from (select * from token_balance where addressId = ?) b
            left join token t on b.contractId = t.hex40id
            ${cond};
        `, {
            type: QueryTypes.SELECT,
            replacements: [addressId],
        }).then(list => list[0]['cntr']));

        const fields = `b.balance, t.base32 as contract, t.type, t.name, t.symbol, t.decimals, t.iconUrl, t.webSite, 
            t.price, t.quoteUrl, t.transfer as totalTransfer`

        let contractIds = "";
        if (addresses?.length) {
            const ids = await getAddrIdArray(addresses);
            if (!ids?.length) {
                return {total: 0, list: []};
            }
            contractIds = `and contractId in (${ids.join(",")})`
        }

        const list = await TokenBalance.sequelize.query(`
            select 
            ${fields}
            from (select * from token_balance where addressId = ? ${contractIds} order by updatedAt desc limit ?) b
            left join token t on b.contractId = t.hex40id
            ${cond}
            order by b.updatedAt desc
            limit ?, ?;
        `, {
            type: QueryTypes.SELECT,
            replacements: [addressId, maxOfAllType, skip, limit],
        });

        list.forEach((token: any) => {
            token.contract = StatApp.isEVM ? format.hexAddress(token.contract) : token.contract;
            token.type = StatApp.isEVM ? token.type : token.type?.replace('ERC', 'CRC');
            TokenQuery.mosaicToken(token);
        });

        if (withRealtimeBalance && list.length) {
            const tokens = list.map((token: any) => token.contract);
            const balances = await BatchBalanceWatcher.getBalances(owner, tokens);
            const tokenBalances = lodash.zipObject(tokens, balances);
            list.forEach((token: any) => {
                token.balance = tokenBalances[token.contract] || token.balance;
            });
        }

        return {total, list};
    }

    private static mosaicToken(token: any) {
        const address = token.address || token.contract;
        token.name = Desensitizer.mosaicStr(address, token.name);
        token.symbol = Desensitizer.mosaicStr(address, token.symbol);
        token.icon = Desensitizer.mosaicIcon(address, token.icon);
        token.iconUrl = Desensitizer.mosaicUri(address, token.iconUrl);
    }

    static async listAccountTokens({ accountAddress }) {
        const balanceMap = {};
        const hex40 = await Hex40Map.findOne({where:{hex:format.hexAddress(accountAddress).substr(2)}});
        if(!hex40) {
            return { balanceMap, tokenArray: [] };
        }
        const addressId = hex40.id;

        const hexIdArray = [];
        const balanceArray = await TokenBalance.findAll({
            where: {addressId},
            order: [['updatedAt', 'desc']],
            //without limit, will hit <out of gas> error
            //TODO fix it
            limit: 100,
        })
        balanceArray.forEach(balance => {
            hexIdArray.push(balance.contractId)
            balanceMap[balance.contractId] = balance;
        });
        // add recent transferred token , in case balance table is not updated in time.
        await Promise.all([T_ADDRESS_ERC20TRANSFER, T_ADDRESS_ERC721_TRANSFER, T_ADDRESS_ERC1155_TRANSFER]
            .map(tableName => {
                TokenBalance.sequelize.query(`select distinct(contractId) from ( select contractId from ${tableName} 
                        where addressId = ${addressId} order by epoch desc limit 10) tmp;`,
                    {type: QueryTypes.SELECT,})
                    .then(transfers => transfers?.forEach(transfer =>
                        hexIdArray.push(transfer["contractId"])));
            }));

        if(hexIdArray.length === 0) {
            return { balanceMap, tokenArray: [] };
        }

        const options: any = {
            attributes: ['name','symbol','decimals','base32', 'hex40id', 'iconUrl', 'type', 'price', 'quoteUrl'],
            where: { hex40id: {[Op.in]: hexIdArray}, auditResult: true, destroyed: false }, raw: true };
        const tokenArray = await Token.findAll(options);
        tokenArray.forEach(t=>{
            if (t.type?.endsWith('721') || t.type?.endsWith('1155')) {
                t['isNFT'] = true;
            }
        })
        return {balanceMap, tokenArray};
    }

    private async addSecurityAuditInfo(tokenArray) {
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
                audit: { result: securityAudit?.audit ? 1 : 0, auditUrl: securityAudit?.auditUrl },
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
                },
            };
            if (securityAudit?.officialLabels) {
                item.securityAudit.officialLabels = securityAudit.officialLabels?.split(NAME_TAG_SPLIT);
            }
        });
    }

    public static async detectTokenType({base32 = undefined, hex40id = undefined}){
        if(!base32 && !hex40id) {
            throw new Errors.ParameterError(`detect token type error`);
        }

        if(!hex40id){
            const hexBean = await Hex40Map.findOne({where: {hex: format.hexAddress(base32).substr(2)}});
            hex40id = hexBean?.id;
        }
        if(!hex40id){
            return {hex40id, type: undefined};
        }

        let [transfer20, transfer721, transfer1155] = await Promise.all([
            Erc20Transfer.findOne({ where: { contractId: hex40id }}),
            Erc721Transfer.findOne({ where: { contractId: hex40id }}),
            Erc1155Transfer.findOne({ where: { contractId: hex40id }}),
        ]);

        let type;
        if(transfer20)  type = CONST.TRANSFER_TYPE.ERC20;
        if(transfer721)  type = CONST.TRANSFER_TYPE.ERC721;
        if(transfer1155)  type = CONST.TRANSFER_TYPE.ERC1155;

        return {hex40id, type};
    }

    public async scheduleWrappedToken(delay: number = 1000) {
        const wrappedTokens = CONST.WRAPPED_TOKENS[StatApp.networkId];
        if (!wrappedTokens) {
            console.log('Schedule wrapped token info disabled');
            return;
        }

        const {wrappedCFX, wrappedBTC} = wrappedTokens || {};
        TokenQuery.wrappedCFXAddr = format.address(wrappedCFX, StatApp.networkId);
        TokenQuery.wrappedBTCAddr = format.address(wrappedBTC, StatApp.networkId);

        console.log(`Schedule wrapped token info with delay: ${delay}`);
        const that = this;

        async function repeat() {
            await that.syncWrappedToken().catch(err => {
                console.log(`Schedule wrapped token info fail: `, err);
            });
            setTimeout(repeat, delay);
        }

        repeat().then();
    }

    private async syncWrappedToken() {
        const tokens: Token[]  = await Token.findAll({
            attributes: {exclude: ['icon']},
            where: {base32: {
                    [Op.in] : [TokenQuery.wrappedCFXAddr, TokenQuery.wrappedBTCAddr],
                },
            },
        });

        TokenQuery.wrappedCFX = tokens.find(token => token.base32 === TokenQuery.wrappedCFXAddr);
        TokenQuery.wrappedBTC = tokens.find(token => token.base32 === TokenQuery.wrappedBTCAddr);
    }
}

export type TokenType = 'ERC20' | 'ERC721' | 'ERC1155';
