import {ADDRESS_COUNT_ALL, CONTRACT_COUNT_ALL, KEY_FULL_TX_COUNT, KEY_GAS_USED_PER_SECOND, KV} from "../model/KV";
import {AddressTransactionIndex, FullBlock} from "../model/FullBlock";
import {CONST} from "./common/constant"
import {hex40IdMap} from "../model/HexMap";
import {PruneInfo, PruneType} from "../model/PruneInfo";
import {Conflux} from "js-conflux-sdk";
import {SupplyInfo} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {ConfigInstance} from "../config/StatConfig";
import {calculateEvmPosSupply} from "./ZGSupply";

const lodash = require('lodash');

export class HomepageDashboard {
    private app: {cfx: Conflux};
    private static data = {
        internalContractInfo: {},
        blockchainInfo: {},
        supplyInfo: {},
        dagInfo: {},
    };

    constructor(app: {cfx: Conflux}) {
        this.app = app;
        this.schedule().then();
    }

    static getData() {
        return {...HomepageDashboard.data};
    }

    private async schedule(delay: number = 3000) {
        const that = this;

        async function repeat() {
            await that.run().catch(err => {
                console.log('Schedule home dashboard service fail', err);
            });
            setTimeout(repeat, delay);
        }

        repeat().then();
        console.log(`Schedule home dashboard service with delay: ${delay}`);
    }

    async internalContractInfo() {
        const hexIdMap = await hex40IdMap(CONST.INTERNAL_CONTRACT);

        const result = {};
        for (const [hex, addressId] of hexIdMap.entries()) {
            const count = await AddressTransactionIndex.count({where: {addressId}});
            const pruneInfo = await PruneInfo.findOne({where: {addressId, type: PruneType.ADDR_TX}});
            result[`0x${hex}`] = count + (pruneInfo?.pruned || 0);
        }

        return result;
    }

    private async blockchainInfo() {
        const {
            app: {cfx},
        } = this;

        const [addressCount, transactionCount, contractCount, gasUsedInfo, maxBlock, status] = await Promise.all([
            KV.getNumber(ADDRESS_COUNT_ALL, 0),
            KV.getNumber(KEY_FULL_TX_COUNT, 0),
            KV.getNumber(CONTRACT_COUNT_ALL, 0),
            KV.getString(KEY_GAS_USED_PER_SECOND, ''),
            FullBlock.findOne({order: [['epoch', 'desc']]}),
            cfx.getStatus().catch(() => undefined),
        ])

        return {
            addressCount,
            transactionCount,
            contractCount,
            epochNumber: maxBlock?.epoch,
            blockNumber: status?.blockNumber,
            gasUsedPerSecond: gasUsedInfo ? Number((JSON.parse(gasUsedInfo)).gasUsedPerSecond) : undefined,
        };
    }

    private async supplyInfo() {
        const {
            app: {cfx},
        } = this;

        const [supplyInfo, nullAddressBalance] = await Promise.all([
            cfx.getSupplyInfo(),
            cfx.getBalance(CONST.ZERO_ADDRESS),
        ])

        const patchedInfo = await patchSupplyInfo(supplyInfo, nullAddressBalance.valueOf());

        return {
            ...supplyInfo,
            ...patchedInfo,
            ...(patchedInfo?.calculateEvmPosSupply ? undefined : {twoYearUnlockBalance: 0n, fourYearUnlockBalance: 0n}),
            nullAddressBalance,
        }
    }

    async dagInfo({limit = 10} = {}) {
        const {
            app: {cfx},
        } = this;

        const epochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE).then((num: number) => {
            return num - 5;
        });

        const list = await Promise.all(lodash.range(limit).map(async (index: number) => {
            const blockHashes = await cfx.getBlocksByEpochNumber(epochNumber - index);
            const blocks = await Promise.all(blockHashes.map((hash: string) => cfx.getBlockByHash(hash)));
            return [...blocks].reverse();
        })).catch(e => {
            if (e.code === -32602) { //  Invalid params: expected a numbers with less than largest epoch number.
                return undefined;
            }
            throw e;
        });

        if (!list) {
            return undefined;
        }

        return {total: epochNumber, list};
    }

    private async run() {
        const data = HomepageDashboard.data;
        data.internalContractInfo = {
            ...data.internalContractInfo,
            ...(await this.internalContractInfo()),
        };
        data.blockchainInfo = {
            ...data.blockchainInfo,
            ...(await this.blockchainInfo()),
        };
        data.supplyInfo = {
            ...data.supplyInfo,
            ...(await this.supplyInfo().catch(e => console.log(`${__filename} supply info error:`, e))),
        };
        data.dagInfo = {
            ...data.dagInfo,
            ...(await this.dagInfo().catch(e => console.log(`${__filename} dag info error:`, e))),
        };
    }
}

/**
 * How much of `balance(0x0)` has been credited back into the reported supply, in drip.
 * Subtract it from a gross figure to get a net one:
 *
 *     total       = totalIssued      - creditedStakeDrip(supplyInfo)
 *     circulating = totalCirculating - creditedStakeDrip(supplyInfo)
 *
 * On 0G, staking burns into 0x0 on the eSpace side and mints on the consensus side, and
 * unstaking emits a block withdrawal and burns on the consensus side. So `balance(0x0)`
 * is the cumulative amount ever staked, and `calculateEvmPosSupply()`'s
 * `totalIssued = genesis + blockWithdraw + totalStakes` counts part of it a second time.
 *
 * Only the part that actually came back -- as a block withdrawal or as consensus layer
 * balance -- is that double count, so that is all we take off. The rest of
 * `balance(0x0)` was burned and credited nowhere yet (pending activation, slashed, or not
 * reported by `effective_balance`); subtracting it would remove supply that was never
 * added. The clamp is what keeps these figures sane when `validatorRpc` or the block
 * withdrawal sync drops out and those terms read 0 -- without it, a `totalStakes` of 0
 * once took the published circulating supply down by 73%.
 *
 * Core space is unchanged: there `getSupplyInfo()` answers for itself, there is no double
 * count to clamp, and the whole zero address balance comes off as it always did.
 */
export function creditedStakeDrip(supplyInfo: any): bigint {
    const staked = BigInt(supplyInfo?.nullAddressBalance || 0);
    if (!supplyInfo?.calculateEvmPosSupply) {
        return staked;
    }
    const credited = BigInt(supplyInfo.sumBlockWithdrawal || 0) + BigInt(supplyInfo.totalStakes || 0);
    return credited < staked ? credited : staked;
}

export async function patchSupplyInfo(supplyInfo: SupplyInfo, balanceOfZero: bigint): Promise<SupplyInfo&any> {
    if (supplyInfo?.totalCirculating == 0n && ConfigInstance.noCoreSpace && ConfigInstance.isEvm) {
        return calculateEvmPosSupply(balanceOfZero);
    } else {
        return supplyInfo;
    }
}