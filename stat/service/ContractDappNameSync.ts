import {abi as abiSwappiFactory} from "./abi/SwappiFactory";
import {abi as abiSwappiPair} from "./abi/SwappiPair";
import {Conflux, format} from "js-conflux-sdk";
import {CONST} from "./common/constant";
import {fmtAddr, StatApp} from "../StatApp";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {TokenTool} from "./tool/TokenTool";
import {Token} from "../model/Token";

export class ContractDappNameSync {
    private cfx: Conflux;
    private tokenTool: TokenTool;

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
            })
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
}
