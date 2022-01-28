const CONST = require('./common/constant');

export class MarketDataQuery {
    protected app;

    constructor(app: any) {
        this.app = app;
    }

    public async getMarketData() {
        const {
            app: {cfx},
        } = this;

        const supplyInfo = await cfx.getSupplyInfo();
        const nullAddressBalance = await cfx.getBalance(CONST.ZERO_ADDRESS);
        const twoYearUnlockBalance = await cfx.getBalance(CONST.TWO_YEAR_UNLOCK);
        const fourYearUnlockBalance = await cfx.getBalance(CONST.FOUR_YEAR_UNLOCK);

        return {...supplyInfo, nullAddressBalance, twoYearUnlockBalance, fourYearUnlockBalance};
    }
}
