import {abi as abiSwappiFactory} from "./abi/SwappiFactory";
import {abi as abiSwappiPair} from "./abi/SwappiPair";
import {Conflux, format} from "js-conflux-sdk";
import {CONST} from "./common/constant";
import {fmtAddr, StatApp} from "../StatApp";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {TokenTool} from "./tool/TokenTool";
import {Token} from "../model/Token";
import {Op} from "sequelize";

export class ContractDappNameSync {
    private cfx: Conflux;
    private tokenTool: TokenTool;
    private updateNFTPositionAlready: boolean;

    constructor({cfx}: { cfx: Conflux }) {
        this.cfx = cfx;
        this.tokenTool = new TokenTool(cfx);
        this.schedule().then();
    }

    async schedule(interval: number = 1000 * 30) {
        const that = this;

        async function repeat() {
            await that.updateLpNames().catch(err => {
                safeAddErrorLog('dapp-name-task', 'lp-name', err).then();
                console.log("[dapp name]schedule error", err);
            });
            await that.updateNFTPositionNames().catch(err => {
                safeAddErrorLog('dapp-name-task', 'nft-position-name', err).then();
                console.log("[dapp name]schedule error", err);
            });
            setTimeout(repeat, interval);
        }

        repeat().then();
        console.log(`[dapp_name]schedule in ${interval}ms interval`);
    }

    private async updateLpNames() {
        const factories = CONST.SWAPPI_FACTORY_LIST[StatApp.networkId];
        if (!factories?.length) {
            return;
        }

        for (const factory of factories) {
            await this.updateLpNamesByFactory(factory);
        }
    }

    private async updateLpNamesByFactory(address: string) {
        const factory = this.cfx.Contract({address, abi: abiSwappiFactory});
        const size = Number(await factory.allPairsLength());

        for (let i = 0; i < size; i++) {
            const address = await factory.allPairs(i);

            const token = await Token.findOne({
                attributes: {exclude: ['icon']},
                where: {base32: format.address(address, StatApp.networkId)}
            });
            if (!token || token.name.includes("/")) {
                continue;
            }

            const contract = this.cfx.Contract({address, abi: abiSwappiPair});
            const token0 = await this.tokenTool.getToken(fmtAddr(await contract.token0(), StatApp.networkId));
            const token1 = await this.tokenTool.getToken(fmtAddr(await contract.token1(), StatApp.networkId));
            const lpToken = await this.tokenTool.getToken(address);

            const name = `${lpToken.name} ${token0.symbol}/${token1.symbol}`;
            await Token.update({name}, {where: {base32: format.address(address, StatApp.networkId)}});
            console.log(`Swappi lp ${fmtAddr(address, StatApp.networkId)} ${name}`);
        }
    }

    private async updateNFTPositionNames() {
        if (this.updateNFTPositionAlready) {
            return;
        }

        const addresses = CONST.SWAPPI_NFT_POSITION_LIST[StatApp.networkId];
        if (!addresses?.length) {
            this.updateNFTPositionAlready = true;
            return;
        }

        const tokens = await Token.findAll({
            attributes: {exclude: ['icon']},
            where: {base32: {[Op.in]: addresses.map(item => format.address(item, StatApp.networkId))}},
            raw: true,
        });
        if (!tokens?.length) {
            return;
        }

        const searches = Object.keys(CONST.SWAPPI_NFT_POSITION_NAME_REPLACES);
        const toUpdateTokens = tokens.filter(item =>
            searches.some(key => item?.name?.includes(key)) || searches.some(key => item?.symbol?.includes(key))
        ).map(item => {
            for (const search of searches) {
                const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                const replace = CONST.SWAPPI_NFT_POSITION_NAME_REPLACES[search];
                if (item.name) {
                    item.name = item.name.replace(regex, replace);
                }
                if (item.symbol) {
                    item.symbol = item.symbol.replace(regex, replace);
                }
            }
            return item;
        });
        if (toUpdateTokens?.length) {
            await Token.bulkCreate(toUpdateTokens, {updateOnDuplicate: ["name", "symbol"]});
        }

        if (addresses.length === tokens.length) {
            this.updateNFTPositionAlready = true;
        }
    }
}
