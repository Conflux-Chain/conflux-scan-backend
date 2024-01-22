// @ts-ignore
import {Hex40Map} from "../model/HexMap";
import {ADDRESS_COUNT_ALL, CONTRACT_COUNT_ALL, KEY_FULL_TX_COUNT, KEY_GAS_USED_PER_SECOND, KV} from "../model/KV";
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
            app: {cfx},
        } = this;

        const addressCount = await KV.getNumber(ADDRESS_COUNT_ALL, 0)
        const transactionCount = await KV.getNumber(KEY_FULL_TX_COUNT, 0);
        const contractCount = await KV.getNumber(CONTRACT_COUNT_ALL, 0)
        const maxBlock = await FullBlock.findOne({order: [['epoch', 'desc']]});
        const status = await cfx.getStatus().catch(() => undefined);

        return {addressCount, transactionCount, contractCount, epochNumber: maxBlock?.epoch, blockNumber: status?.blockNumber};
    }

    private async supplyInfo() {
        const {
            app: {cfx},
        } = this;

        const supplyInfo = await cfx.getSupplyInfo();
        const nullAddressBalance = await cfx.getBalance(CONST.ZERO_ADDRESS);
        const twoYearUnlockBalance = await cfx.getBalance(CONST.TWO_YEAR_UNLOCK);
        const fourYearUnlockBalance = await cfx.getBalance(CONST.FOUR_YEAR_UNLOCK);

        supplyInfo.totalCirculating = `${BigInt(supplyInfo.totalCirculating) - BigInt(nullAddressBalance)}`;

        return { ...supplyInfo, nullAddressBalance, twoYearUnlockBalance, fourYearUnlockBalance };
    }

    async dagInfo({ limit = 10 } = {}) {
        const {
            app: { cfx },
        } = this;

        const epochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);
        const matrix = await Promise.all(lodash.range(limit).map(async (index) => {
            const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber - index);
            const blockArray = await Promise.all(blockHashArray.map((hash) => cfx.getBlockByHash(hash)));
            return [...blockArray].reverse();
        }));

        return {total: epochNumber, list: matrix};
    }

    private async run() {
        const blockchainInfo = await this.blockchainInfo().catch((e) => {
            console.log(`${__filename} error`, e)
            return {} as any
        });
        blockchainInfo.blockNumber !== undefined && lodash.assign(this.data.blockchainInfo, blockchainInfo);

        const supplyInfo = await this.supplyInfo().catch(e=>console.log(`${__filename} supply info error:`, e));
        supplyInfo !== undefined && lodash.assign(this.data.supplyInfo, supplyInfo);

        const dagInfo = await this.dagInfo().catch(() => undefined);
        dagInfo !== undefined && lodash.assign(this.data.dagInfo, dagInfo);

        const gasUsedInfo = await KV.findOne({where: {key: KEY_GAS_USED_PER_SECOND}})
        if(gasUsedInfo !== undefined) {
            const gasUsedInfoObj = JSON.parse(gasUsedInfo?.value)
            lodash.assign(this.data.blockchainInfo, {gasUsedPerSecond: Number(gasUsedInfoObj.gasUsedPerSecond)})
            // console.log(`cacheStatGasUsedPerSecond ${JSON.stringify(this.data.blockchainInfo)}`)
        }
    }
}
