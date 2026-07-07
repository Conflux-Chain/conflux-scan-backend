import {IToken, Token} from "../model/Token";
import {Op, QueryTypes} from 'sequelize'
import {fmtAddr, StatApp} from "../StatApp";
import {Conflux, format} from "js-conflux-sdk";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {TokenTool} from "./tool/TokenTool";
import {Hex40Map} from "../model/HexMap";
import {CONST} from "./common/constant";
import {KEY_AUTO_DETECT_TOKEN_EPOCH, KEY_AUTO_DETECT_TOKEN_TRACE_ID, KV} from "../model/KV";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {sanitizeToken} from "./common/utils";
import {ethers} from "ethers";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {ContractQuery, ImplInfo} from "./ContractQuery";
import {EpochHashTokenTransfer} from "../TokenTransferSync";

const lodash = require('lodash');

const SELECTORS = {
    // func
    name: "06fdde03",
    symbol: "95d89b41",
    decimals: "313ce567",
    totalSupply: "18160ddd",
    supportsInterface: "01ffc9a7",
    // event - ERC20/ERC721
    Transfer: ethers.id("Transfer(address,address,uint256)").toLowerCase().slice(2),
    // event - ERC1155
    TransferSingle: ethers.id("TransferSingle(address,address,address,uint256,uint256)").toLowerCase().slice(2),
    TransferBatch: ethers.id("TransferBatch(address,address,address,uint256[],uint256[])").toLowerCase().slice(2),
}

export class TokenAutoDetect {
    private cfx: Conflux;
    private readonly tokenTool: TokenTool;

    constructor(cfx: Conflux) {
        this.cfx = cfx;
        this.tokenTool = new TokenTool(cfx);
        this.schedule().then();
    }

    private async schedule(delay: number = 1_000) {
        const that = this

        async function repeat() {
            await that.batchDetect().catch(err => {
                safeAddErrorLog('token-x', 'detect-token', err).then();
                console.log(`Failed to detect token`, err);
            });
            await that.batchDetectByTransfer().catch(err => {
                safeAddErrorLog('token-x', 'detect-token', err).then();
                console.log(`Failed to detect token by transfer`, err);
            });
            setTimeout(repeat, delay)
        }

        repeat().then()
        console.log(`Succeed to schedule detect token in ${delay / 1000}s interval`)
    }

    private async batchDetect() {
        const lastId = await KV.getNumber(KEY_AUTO_DETECT_TOKEN_TRACE_ID, 0);

        const traces = await TraceCreateContract.findAll({
            attributes: ["id", "to"],
            where: {
                id: {[Op.gt]: lastId}
            },
            order: [["id", "asc"]],
            limit: 100,
            raw: true,
        });

        if (traces.length === 0) {
            return;
        }

        for (const {to: id} of traces) {
            const address = await Hex40Map.findOne({where: {id}, raw: true}).then(item => `0x${item.hex}`);

            let token = await TokenAutoDetect.detect(address, this.tokenTool, false);
            if (token === undefined) {
                continue;
            }

            token = await TokenAutoDetect.buildToken(id, token);

            await Token.upsert(token);
        }

        await KV.upsert({key: KEY_AUTO_DETECT_TOKEN_TRACE_ID, value: `${traces[traces.length - 1].id}`});
    }

    static async detect(
        address: string,
        tokenTool: TokenTool,
        detectBytecode: boolean,
        printDetail?: boolean
    ) {
        const addr = fmtAddr(address, StatApp.networkId);
        const {implementation: impl, proxyPattern} = await TokenAutoDetect.getImpl(addr, tokenTool.cfx) || {};

        const code = await tokenTool.cfx.getCode(impl || addr);
        if (!code || code === "0x") {
            return;
        }

        const selectors: any = TokenAutoDetect.detectSelectors(code, SELECTORS, detectBytecode);

        const [tokenInfo, totalSupply, erc721Interface, erc1155Interface] = await Promise.all([
            tokenTool.getToken(addr),
            tokenTool.getTokenTotalSupply(addr),
            tokenTool.supportsInterface(addr, CONST.EIP165_INTERFACE_ID.ERC721),
            tokenTool.supportsInterface(addr, CONST.EIP165_INTERFACE_ID.ERC1155),
        ]);

        const hasFunc = (funcName: string): boolean => {
            if (funcName === "totalSupply") {
                return selectors[funcName] && totalSupply !== undefined;
            }
            return selectors[funcName] && tokenInfo[funcName] !== undefined && tokenInfo[funcName] !== null;
        }

        const hasEvent = (eventName: string): boolean => {
            return selectors[eventName];
        }

        const supportsInterface = (type: string): boolean => {
            switch (type) {
                case CONST.TRANSFER_TYPE.ERC721:
                    return selectors.supportsInterface && erc721Interface;
                case CONST.TRANSFER_TYPE.ERC1155:
                    return selectors.supportsInterface && erc1155Interface;
                default:
                    return false;
            }
        }

        printDetail && console.log("detect token ==\n", {
            addr,
            impl,
            tokenInfo,
            totalSupply,
            proxyPattern,
            supportSelectors: selectors,
            supportErc721Interface: erc721Interface === true,
            supportErc1155Interface: erc1155Interface === true,
        })

        if (!hasFunc("name") || !hasFunc("symbol")) {
            return;
        }

        const token = TokenAutoDetect.validateToken(tokenInfo, totalSupply);
        if (!token) {
            return;
        }

        if (
            supportsInterface(CONST.TRANSFER_TYPE.ERC1155)
            && hasEvent("TransferSingle")
            && hasEvent("TransferBatch")
        ) {
            return lodash.assign(token, {type: CONST.TRANSFER_TYPE.ERC1155});
        }

        if (
            supportsInterface(CONST.TRANSFER_TYPE.ERC721)
            && hasEvent("Transfer")
        ) {
            return lodash.assign(token, {type: CONST.TRANSFER_TYPE.ERC721});
        }

        if (
            hasFunc("decimals")
            && hasFunc("totalSupply")
            && hasEvent("Transfer")
        ) {
            return lodash.assign(token, {type: CONST.TRANSFER_TYPE.ERC20});
        }
    }

    private async batchDetectByTransfer() {
        const lastEpoch = await KV.getNumber(KEY_AUTO_DETECT_TOKEN_EPOCH, 0);
        const epochRange: any = await this.nextEpochRange(lastEpoch);
        if (!epochRange) {
            return;
        }

        const sql = [
            [CONST.TRANSFER_TYPE.ERC20, Erc20Transfer],
            [CONST.TRANSFER_TYPE.ERC721, Erc721Transfer],
            [CONST.TRANSFER_TYPE.ERC1155, Erc1155Transfer]]
            .map(([type, model]: [string, any]) => `
                select distinct(contractId) as id, '${type}' as type
                from ${model.getTableName()} 
                where epoch between :minEpoch and :maxEpoch`)
            .join("\nunion\n");
        const transfers: any[] = await Erc20Transfer.sequelize.query(sql, {
            type: QueryTypes.SELECT,
            replacements: {minEpoch: epochRange.min, maxEpoch: epochRange.max},
            raw: true
        });

        if (transfers.length === 0) {
            await KV.upsert({key: KEY_AUTO_DETECT_TOKEN_EPOCH, value: `${epochRange.max}`});
            return;
        }

        for (const {id, type} of transfers) {
            const address = await Hex40Map.findOne({where: {id}, raw: true}).then(item => `0x${item.hex}`);

            let token = await TokenAutoDetect.detectByTransfer(address, this.tokenTool, type);
            if (token === undefined) {
                continue;
            }

            const {type: existType} = await Token.findOne({where: {hex40id: id}, raw: true}) || {};
            if (
                existType === undefined ||
                (
                    (
                        existType === CONST.TRANSFER_TYPE.ERC20
                        || existType === CONST.TRANSFER_TYPE.ERC721
                        || existType === CONST.TRANSFER_TYPE.ERC1155
                    )
                    && Number(token.type.slice(3)) > Number(existType.slice(3))
                )
            ) {
                token = await TokenAutoDetect.buildToken(id, token);
                await Token.upsert(token);
            }
        }

        await KV.upsert({key: KEY_AUTO_DETECT_TOKEN_EPOCH, value: `${epochRange.max}`});
    }

    static async detectByTransfer(
        address: string,
        tokenTool: TokenTool,
        type: string,
        printDetail?: boolean
    ) {
        const addr = fmtAddr(address, StatApp.networkId);

        const [tokenInfo, totalSupply, erc721Interface, erc1155Interface] = await Promise.all([
            tokenTool.getToken(addr),
            tokenTool.getTokenTotalSupply(addr),
            tokenTool.supportsInterface(addr, CONST.EIP165_INTERFACE_ID.ERC721),
            tokenTool.supportsInterface(addr, CONST.EIP165_INTERFACE_ID.ERC1155),
        ]);

        printDetail && console.log(`detectTokenByType`, {
            addr,
            tokenInfo,
            totalSupply,
            supportErc721Interface: erc721Interface === true,
            supportErc1155Interface: erc1155Interface === true,
        })

        const token = TokenAutoDetect.validateToken(tokenInfo, totalSupply);
        if (!token) {
            return;
        }

        if (type === CONST.TRANSFER_TYPE.ERC1155) {
            return erc1155Interface === true ? lodash.assign(token, {type: CONST.TRANSFER_TYPE.ERC1155}) : undefined;
        }

        if (type === CONST.TRANSFER_TYPE.ERC721) {
            return erc721Interface === true ? lodash.assign(token, {type: CONST.TRANSFER_TYPE.ERC721}) : undefined;
        }

        if (type === CONST.TRANSFER_TYPE.ERC20) {
            return lodash.assign(token, {type: CONST.TRANSFER_TYPE.ERC20});
        }
    }

    private DETECT_EPOCHS_PER_TIME = 1000;
    private DETECT_EPOCHS_REORG_OCCURS = 100;

    private async nextEpochRange(cur: number) {
        const maxSynced: number | null = await EpochHashTokenTransfer.max("epoch");
        if (maxSynced === null) {
            return;
        }

        if (cur === maxSynced) {
            return;
        }

        if (cur > maxSynced) {
            return {min: Math.max(0, maxSynced - this.DETECT_EPOCHS_REORG_OCCURS), max: maxSynced};
        }

        const min = cur + 1;
        const max = min + this.DETECT_EPOCHS_PER_TIME - 1;

        return {min, max: Math.min(max, maxSynced)};
    }

    private static detectSelectors(code, selectors, required: boolean) {
        const hex = code.toLowerCase();

        const supportSelectors = {};
        for (const [name, selector] of Object.entries(selectors)) {
            supportSelectors[name] = required ? hex.includes((selector as string).toLowerCase()) : true;
        }

        return supportSelectors;
    }

    private static async countTransfer(addressId, transferType) {
        if (transferType === CONST.TRANSFER_TYPE.ERC20)
            return Erc20Transfer.count({where: {contractId: addressId}});
        if (transferType === CONST.TRANSFER_TYPE.ERC721)
            return Erc721Transfer.count({where: {contractId: addressId}});
        if (transferType === CONST.TRANSFER_TYPE.ERC1155)
            return Erc1155Transfer.count({where: {contractId: addressId}});
    }

    private static async getImpl(address, cfx: Conflux): Promise<ImplInfo | undefined> {
        const implInfo = await ContractQuery._getImpl(cfx, address);
        if (implInfo) {
            return implInfo;
        }

        const code = await cfx.getCode(address);
        if (CONST.REGEX_EIP1167_BYTECODE.test(code)) {
            return {
                implementation: fmtAddr(`0x${code.substr(22, 40)}`, StatApp.networkId),
                proxyPattern: CONST.PROXY_PATTERN.MINIMAL_PROXY,
            }
        }
    }

    private static validateToken(tokenInfo, totalSupply) {
        const auditResult = typeof tokenInfo.name === "string" && tokenInfo.name.trim().length > 0
            && typeof tokenInfo.symbol === "string" && tokenInfo.symbol.trim().length > 0;

        if (!auditResult) {
            return;
        }

        return {
            base32: format.address(tokenInfo.address, StatApp.networkId),
            ...tokenInfo,
            totalSupply,
            auditResult,
            fetchBalance: auditResult
        };
    }

    static async buildToken(addressId: number, token: IToken) {
        const transferCount = (await TokenAutoDetect.countTransfer(addressId, token.type)) || 0;

        token = lodash.defaults(token, {
            hex40id: addressId,
            transfer: transferCount,
        });

        sanitizeToken(token);

        return token;
    }
}
