// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {abi} from "./contract/BatchBalanceOf";
import {EventBus} from "./EventBus";
import {Erc20WatchList} from "../../config/StatConfig";
import {BalanceWatcher} from "./BalanceWatcher";
import {makeId} from "../../model/HexMap";

const batchContractAddress = '0x8f35930629fce5b5cf4cd762e71006045bfeb24d'
export class BatchBalanceWatcher {
    private cfx: Conflux;
    private contract: {balances};
    private readonly tokenList: string[];
    private erc20list: Erc20WatchList[];
    fraction = BigInt(1e+18)
    constructor( cfx:Conflux, erc20List:Erc20WatchList[]) {
        this.cfx = cfx;
        // @ts-ignore
        this.contract = cfx.Contract({abi, address: format.address(batchContractAddress, cfx.networkId)})
        this.tokenList = erc20List.map(erc20=>erc20.address)
        this.erc20list = erc20List
    }
    public async balanceOf(userAddr) {
        let banList = await this.contract.balances([userAddr], this.tokenList)
        let i = 0
        for (const erc20 of this.erc20list) {
            let model = BalanceWatcher.mapModel(erc20.name)
            let id = (await makeId(userAddr)).id
            await BalanceWatcher.saveModel(model, id, banList[i], true, this.fraction)
            i++
        }
        console.log(`balance list is: ${banList}`)
    }

    public async schedule(delay = 10_000) {
        if (this.erc20list.length === 0) {
            return;
        }
        //
        const that = this;
        async function repeat() {
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
        console.log(`schedule batch balance watcher with delay ${delay}.`)
    }

    async run() {
        const txAddressSet = EventBus.swapAddressSet();
        if (txAddressSet.size === 0) {
            return
        }
        for (const hex of txAddressSet) {
            await this.balanceOf(hex)
        }
    }
}