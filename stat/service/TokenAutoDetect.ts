import {Token} from "../model/Token";
import {Op} from 'sequelize'
import {fmtAddr, StatApp} from "../StatApp";
import {Conflux, format} from "js-conflux-sdk";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {TokenTool} from "./tool/TokenTool";
import {Hex40Map} from "../model/HexMap";
import {CONST} from "./common/constant";
import {KEY_AUTO_DETECT_TOKEN_TRACE_ID, KV} from "../model/KV";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {sanitizeToken} from "./common/utils";
import {ethers} from "ethers";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {ContractQuery, ImplInfo} from "./ContractQuery";

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

    public async schedule(delay: number = 1_000) {
        const that = this

        async function repeat() {
            await that.run().catch(err => {
                safeAddErrorLog('token-x', 'detect-token', err).then();
                console.log(`Failed to detect token`, err);
            });
            setTimeout(repeat, delay)
        }

        repeat().then()
        console.log(`Succeed to schedule detect token in ${delay / 1000}s interval`)
    }

    private async run() {
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

        for (const trace of traces) {
            const addressId = trace.to;
            const hex = await Hex40Map.findOne({where: {id: addressId}, raw: true});
            const address = format.address(`0x${hex.hex}`, StatApp.networkId);

            const {implementation} = await TokenAutoDetect.getImpl(address, this.cfx) || {};

            let token = await TokenAutoDetect.detectToken(address, implementation, this.cfx, this.tokenTool);
            if (token === undefined) {
                continue;
            }

            const transferCount = (await this.countTransfer(addressId, token.transferType)) || 0;
            const auditResult = (token.name.trim().length > 0) && (token.symbol.trim().length > 0);
            token = lodash.defaults(token, {
                hex40id: addressId,
                transfer: transferCount,
                auditResult,
                fetchBalance: auditResult
            });

            sanitizeToken(token);

            await Token.upsert(token);
        }

        await KV.upsert({key: KEY_AUTO_DETECT_TOKEN_TRACE_ID, value: `${traces[traces.length - 1].id}`})
    }

    static async detectToken(
        addr: string,
        impl: string,
        cfx: Conflux,
        tokenTool: TokenTool,
        debug?: boolean
    ) {
        const code = await cfx.getCode(impl || addr);
        if (!code || code === "0x") {
            return;
        }

        const selectors: any = TokenAutoDetect.detectSelectors(code, SELECTORS);

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
            return selectors[funcName] && tokenInfo[funcName] !== undefined;
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

        debug && console.log(`detectToken`, {
            addr,
            impl,
            tokenInfo,
            totalSupply,
            supportSelectors: selectors,
            supportErc721Interface: erc721Interface === true,
            supportErc1155Interface: erc1155Interface === true,
        })

        if (!hasFunc("name") || !hasFunc("symbol")) {
            return;
        }

        const token = {
            base32: addr,
            totalSupply,
            ...tokenInfo,
        };

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

        return;
    }

    static detectSelectors(code, selectors) {
        const hex = code.toLowerCase();

        const supportSelectors = {};
        for (const [name, selector] of Object.entries(selectors)) {
            supportSelectors[name] = hex.includes((selector as string).toLowerCase());
        }

        return supportSelectors;
    }

    private async countTransfer(addressId, transferType) {
        if (transferType === CONST.TRANSFER_TYPE.ERC20)
            return Erc20Transfer.count({where: {contractId: addressId}});
        if (transferType === CONST.TRANSFER_TYPE.ERC721)
            return Erc721Transfer.count({where: {contractId: addressId}});
        if (transferType === CONST.TRANSFER_TYPE.ERC1155)
            return Erc1155Transfer.count({where: {contractId: addressId}});
    }

    static async getImpl(address, cfx: Conflux): Promise<ImplInfo | undefined> {
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

        return;
    }
}
