// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {abi} from "./contract/BatchBalanceOf";
import {EventBus} from "./EventBus";
import {Erc20WatchList} from "../../config/StatConfig";
import {BalanceWatcher, CfxWatcher} from "./BalanceWatcher";
import {makeId} from "../../model/HexMap";
import {fmtDtUTC} from "../../model/Utils";
import {StatApp} from "../../StatApp";
import {BALANCE_UTIL_ABI} from "./contract/BalanceUtilAbi";

export const batchContractAddress = '0x8f35930629fce5b5cf4cd762e71006045bfeb24d'
const MAINNET_UTIL_CONTRACT = 'cfx:acevvs939myrr1w283cr5pt90v5bvp2us62g27zp28'
const TESTNET_UTIL_CONTRACT = 'cfxtest:acb4j27jhmvpvnzfcn7rmgfk90b1xkxw263ba2jv6x'
export class BatchBalanceWatcher {
    private cfx: Conflux;
    public static contract: {balances};
    public static allTokenContract: {balancesOf};
    private readonly tokenList: string[];
    private readonly erc20list: Erc20WatchList[];
    fraction = BigInt(1e+18)
    private readonly cfxWatcher:CfxWatcher
    constructor( cfx:Conflux, erc20List:Erc20WatchList[], cfxWatcher:CfxWatcher) {
        this.cfx = cfx;
        this.cfxWatcher = cfxWatcher;
        // @ts-ignore
        BatchBalanceWatcher.contract = cfx.Contract({abi, address: format.address(batchContractAddress, StatApp.networkId)})
        const utilContract = StatApp.networkId === 1 ? TESTNET_UTIL_CONTRACT : MAINNET_UTIL_CONTRACT
        // @ts-ignore
        BatchBalanceWatcher.allTokenContract = cfx.Contract({abi: BALANCE_UTIL_ABI, address: utilContract})
        this.tokenList = erc20List.map(erc20=>erc20.address)
        this.erc20list = erc20List
        this.txAddressSet = null
    }
    public async balanceOf(userAddr) {
        if (this.erc20list.length === 0) {
            return;
        }
        let banList = await BatchBalanceWatcher.contract.balances([userAddr], this.tokenList)
        let i = 0
        for (const erc20 of this.erc20list) {
            let model = BalanceWatcher.mapModel(erc20.name)
            let id = (await makeId(userAddr)).id
            await BalanceWatcher.saveModel(model, id, banList[i], true, this.fraction)
            i++
        }
    }

    public async schedule(delay = 10_000) {
        //
        const that = this;
        async function repeat() {
            await that.run().catch(err=>{
                console.log(`error process batch balance:`, err)
            })
            setTimeout(repeat, delay)
        }
        repeat().then()
        console.log(`schedule batch balance watcher with delay ${delay}.`)
    }
    txAddressSet :Set<string>
    async run() {
        if (this.txAddressSet === null) {
            this.txAddressSet = EventBus.swapAddressSet();
        }
        if (this.txAddressSet.size === 0) {
            this.txAddressSet = null
            console.log(`swapAddressSet empty data. 2`)
            return
        }
        for (const hex of this.txAddressSet) {
            await this.balanceOf(hex)
            // update cfx balance.
            if (this.cfxWatcher) {
                let id = (await makeId(hex)).id
                await this.cfxWatcher.queryBalance(hex, id);
            }
        }
        console.log(`${fmtDtUTC(new Date())} batch process address count ${this.txAddressSet.size}`)
        this.txAddressSet = null
    }

    public static async getBalances(account:string, tokens:string[]) {
        let banList = await BatchBalanceWatcher.allTokenContract.balancesOf(account, tokens)
        return banList
    }
}
