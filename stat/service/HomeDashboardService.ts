// @ts-ignore
import {hex40IdMap} from "../model/HexMap";
import {ADDRESS_COUNT_ALL, CONTRACT_COUNT_ALL, KEY_FULL_TX_COUNT, KEY_GAS_USED_PER_SECOND, KV} from "../model/KV";
import {AddressTransactionIndex, FullBlock} from "../model/FullBlock";
import {CONST} from "./common/constant"
import {PruneInfo, PruneType} from "../model/PruneInfo";
import {ScanCtx} from "../../scan-api/service/index";
import {patchSupplyInfo} from "./MarketDataQuery";

const lodash = require('lodash');

let _INST: HomeDashboardService = null;

export function getHomeDashboarData() {
    return _INST?.getData() || {};
}

export class HomeDashboardService{
    protected app;
    protected data = {
        blockchainInfo: {},
        supplyInfo: {},
        dagInfo: {},
        internalContractInfo: {},
    };

    private constructor(app: any) {
        this.app = app;
        _INST = this;
    }

    public static getInstance(app: any): HomeDashboardService {
        if (!_INST) {
            new HomeDashboardService(app)
        }
        return _INST;
    }

    public getData(){
        return this.data;
    }

    public async schedule(delay: number = 1000) {

        console.log('HomeDashboardService ', `schedule home_dashboard_service with delay: ${delay}`)
        const that = this
        async function repeat() {
            await that.run().catch(err =>{
                console.log('HomeDashboardService home_dashboard_service fail, error:', err);
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
        const {app: {cfx},} = this;
        if (this.app.config.supplyNotAvailable) {
            return {}
        }


        let supplyInfo = await cfx.getSupplyInfo();
        const nullAddressBalance = await cfx.getBalance(CONST.ZERO_ADDRESS);
        supplyInfo = await patchSupplyInfo(supplyInfo, nullAddressBalance.valueOf());

        const twoYearUnlockBalance = 0n;//await cfx.getBalance(CONST.TWO_YEAR_UNLOCK);
        const fourYearUnlockBalance = 0n;//await cfx.getBalance(CONST.FOUR_YEAR_UNLOCK);

        supplyInfo.totalCirculating = `${BigInt(supplyInfo.totalCirculating) - BigInt(nullAddressBalance)}`;

        return { ...supplyInfo, nullAddressBalance, twoYearUnlockBalance, fourYearUnlockBalance };
    }

    async dagInfo({ limit = 10 } = {}) {
        const {
            app: { cfx },
        } = this as unknown as ScanCtx;
        let ready = true;
        const epochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE).then(res=>{
            return res - 5;
        });
        const matrix = await Promise.all(lodash.range(limit).map(async (index) => {
            const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber - index).catch(e=>{
                if (e.code === -32602) {
                    //  Invalid params: expected a numbers with less than largest epoch number.
                    ready = false;
                    return [] as string[]
                }
                throw e;
            });
            const blockArray = await Promise.all(blockHashArray.map((hash) => cfx.getBlockByHash(hash)));
            return [...blockArray].reverse();
        }));

        return {total: epochNumber, list: matrix, ready};
    }

    async internalContractInfo({ limit = 10 } = {}) {
        const hexIdMap = await hex40IdMap(CONST.INTERNAL_CONTRACT)
        const idHexMap = {};
        hexIdMap.forEach((hexId,hex) => (idHexMap[hexId] = hex));

        const internalContractInfo = {}
        for (const addressId of Object.keys(idHexMap)) {
            const count = await AddressTransactionIndex.count({where: {addressId}})
            const pruneInfo = await PruneInfo.findOne({where: {addressId, type: PruneType.ADDR_TX}})
            internalContractInfo[`0x${idHexMap[addressId]}`] = count + (pruneInfo?.pruned || 0)
        }

        return internalContractInfo
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
        dagInfo !== undefined && dagInfo.ready && lodash.assign(this.data.dagInfo, dagInfo);

        const internalContractInfo = await this.internalContractInfo().catch(() => undefined)
        internalContractInfo !== undefined && lodash.assign(this.data.internalContractInfo, internalContractInfo)

        const gasUsedInfo = await KV.findOne({where: {key: KEY_GAS_USED_PER_SECOND}})
        if(gasUsedInfo !== undefined) {
            const gasUsedInfoObj = JSON.parse(gasUsedInfo?.value)
            lodash.assign(this.data.blockchainInfo, {gasUsedPerSecond: Number(gasUsedInfoObj.gasUsedPerSecond)})
            // console.log(`cacheStatGasUsedPerSecond ${JSON.stringify(this.data.blockchainInfo)}`)
        }
    }
}
