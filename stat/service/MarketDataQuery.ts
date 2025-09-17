import { Conflux } from "js-conflux-sdk";
import {CONST} from "./common/constant"
import {ConfigInstance} from "../config/StatConfig";
import {SupplyInfo} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {calculateEvmPosSupply} from "./ZGSupply";

export class MarketDataQuery {
    protected app;
    protected data;

    constructor(app: any) {
        this.app = app;
    }

    public getMarketData() {
        return this.data;
    }

    public async scheduleCache(delay = 1000 * 60 * 3) {
        const that = this
        async function repeat() {
            await that.cache().catch(err => {
                console.log(`MarketDataQuery fail: `, err);
            });
            setTimeout(repeat, delay);
        }
        repeat().then();
        console.log(`Schedule MarketDataQuery service`);
    }

    protected async cache() {
        const {
            app: {cfx: _cfx},
        } = this;
        const cfx = _cfx as Conflux;
        const nullAddressBalance = await cfx.getBalance(CONST.ZERO_ADDRESS);

        let supplyInfo = await cfx.getSupplyInfo();
        supplyInfo = await patchSupplyInfo(supplyInfo, nullAddressBalance.valueOf());
        const sPos = supplyInfo["calculateEvmPosSupply"];
        const twoYearUnlockBalance = sPos ? undefined : 0n;//await cfx.getBalance(CONST.TWO_YEAR_UNLOCK);
        const fourYearUnlockBalance = sPos ? undefined : 0n;//await cfx.getBalance(CONST.FOUR_YEAR_UNLOCK);

        this.data = {...supplyInfo, nullAddressBalance, twoYearUnlockBalance, fourYearUnlockBalance};
    }
}

export async function patchSupplyInfo(supplyInfo: SupplyInfo, balanceOfZero: bigint): Promise<SupplyInfo&any> {
    if (supplyInfo?.totalCirculating == 0n && ConfigInstance.noCoreSpace && ConfigInstance.isEvm) {
        return calculateEvmPosSupply(balanceOfZero);
    } else {
        return supplyInfo;
    }
}
