import {CONST} from "./common/constant"

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
            app: {cfx},
        } = this;

        const supplyInfo = await cfx.getSupplyInfo();
        const nullAddressBalance = await cfx.getBalance(CONST.ZERO_ADDRESS);
        const twoYearUnlockBalance = await cfx.getBalance(CONST.TWO_YEAR_UNLOCK);
        const fourYearUnlockBalance = await cfx.getBalance(CONST.FOUR_YEAR_UNLOCK);

        this.data = {...supplyInfo, nullAddressBalance, twoYearUnlockBalance, fourYearUnlockBalance};
    }
}
