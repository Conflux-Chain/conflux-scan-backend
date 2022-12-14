// @ts-ignore
import {Hex40Map} from "../model/HexMap";
import {ADDRESS_COUNT_ALL, CONTRACT_COUNT_ALL, KEY_FULL_TX_COUNT, KV} from "../model/KV";
import {FullBlock} from "../model/FullBlock";
import {CONST} from "./common/constant"

const lodash = require('lodash');

export class HomeDashboardService{
    protected app;
    protected data = {
        blockchainInfo: {},
        supplyInfo: {},
        dagInfo: {},
    };

    constructor(app: any) {
        this.app = app;
    }

    public getData(){
        return this.data;
    }

    public async schedule(delay: number = 1000) {
        const{ logger } = this.app;

        logger?.info({src: 'HomeDashboardService', msg: `schedule home_dashboard_service with delay: ${delay}`})
        const that = this
        async function repeat() {
            await that.run().catch(err =>{
                logger?.info({src: 'HomeDashboardService', msg: `home_dashboard_service fail, error: ${err}`})
            })
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    private async blockchainInfo() {
        const {
            app: {confluxSDK},
        } = this;

        const addressCount = await KV.getNumber(ADDRESS_COUNT_ALL, 0)
        const transactionCount = await KV.getNumber(KEY_FULL_TX_COUNT, 0);
        const contractCount = await KV.getNumber(CONTRACT_COUNT_ALL, 0)
        const maxBlock = await FullBlock.findOne({order: [['epoch', 'desc']]});
        const {blockNumber} = await confluxSDK.getStatus().catch(() => undefined);

        return {addressCount, transactionCount, contractCount, epochNumber: maxBlock.epoch, blockNumber};
    }

    private async supplyInfo() {
        const {
            app: {confluxSDK},
        } = this;

        const supplyInfo = await confluxSDK.getSupplyInfo();
        const nullAddressBalance = await confluxSDK.getBalance(CONST.ZERO_ADDRESS);
        const twoYearUnlockBalance = await confluxSDK.getBalance(CONST.TWO_YEAR_UNLOCK);
        const fourYearUnlockBalance = await confluxSDK.getBalance(CONST.FOUR_YEAR_UNLOCK);

        return { ...supplyInfo, nullAddressBalance, twoYearUnlockBalance, fourYearUnlockBalance };
    }

    async dagInfo({ limit = 10 } = {}) {
        const {
            app: { confluxSDK },
        } = this;

        const epochNumber = await confluxSDK.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);
        const matrix = await Promise.all(lodash.range(limit).map(async (index) => {
            const blockHashArray = await confluxSDK.getBlocksByEpochNumber(epochNumber - index);
            const blockArray = await Promise.all(blockHashArray.map((hash) => confluxSDK.getBlockByHash(hash)));
            return [...blockArray].reverse();
        }));

        return {total: epochNumber, list: matrix};
    }

    private async run() {
        const blockchainInfo = await this.blockchainInfo().catch(() => undefined);
        blockchainInfo.blockNumber !== undefined && lodash.assign(this.data.blockchainInfo, blockchainInfo);

        const supplyInfo = await this.supplyInfo().catch(() => undefined);
        supplyInfo !== undefined && lodash.assign(this.data.supplyInfo, supplyInfo);

        const dagInfo = await this.dagInfo().catch(() => undefined);
        dagInfo !== undefined && lodash.assign(this.data.dagInfo, dagInfo);
    }
}
