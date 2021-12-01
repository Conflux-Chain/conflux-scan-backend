// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {abi} from "./contract/BatchBalanceOf";
import {EventBus} from "./EventBus";
import {Erc20WatchList, RedisConf} from "../../config/StatConfig";
import {BalanceWatcher, CfxWatcher} from "./BalanceWatcher";
import {Hex40Map, idHex40Map, makeId} from "../../model/HexMap";
import {fmtDtUTC} from "../../model/Utils";
import {StatApp} from "../../StatApp";
import {BALANCE_UTIL_ABI} from "./contract/BalanceUtilAbi";
import {CFX_TRANSFER_ADDRESS_Q, RedisStreamMessage, RedisWrap, TRANSFER_ADDRESS_Q,} from "../RedisWrap";
import {Op} from 'sequelize'
import {hex} from "../../test/GenData";
import {DynamicBalanceModel} from "./DynamicBalanceModel";
import {KV, SCAN_UTIL_CONTRACT} from "../../model/KV";

export const batchContractAddress = '0x8f35930629fce5b5cf4cd762e71006045bfeb24d'
const MAINNET_UTIL_CONTRACT = 'cfx:acef1ym9m16fc94x29h0800k0ugnaj91sjjbm60hfh'
const TESTNET_UTIL_CONTRACT = 'cfxtest:achamkxtk3yn534h483vdvv0kcffwr221uyw9xnucr'

export class BatchBalanceWatcher {
    private cfx: Conflux;
    public static contract: {balances};
    public static allTokenContract: {getBalances};
    private readonly tokenList: string[];
    fraction = BigInt(1e+18)
    private readonly cfxWatcher:CfxWatcher
    constructor( cfx:Conflux, cfxWatcher:CfxWatcher, utilContract: string | null) {
        if (!utilContract) {
            console.log(` scan util contract should be an address. Got [${utilContract}]`)
            process.exit(9)
        }
        this.cfx = cfx;
        this.cfxWatcher = cfxWatcher;
        // @ts-ignore
        BatchBalanceWatcher.contract = cfx.Contract({abi, address: format.address(batchContractAddress, StatApp.networkId)})
        // @ts-ignore
        BatchBalanceWatcher.allTokenContract = cfx.Contract({abi: BALANCE_UTIL_ABI, address: utilContract})
    }

    public static async getUtilContractAddr() {
        // use config in DB ?
        const utilContract = StatApp.networkId === 1 ? TESTNET_UTIL_CONTRACT :
            StatApp.networkId === 1029 ? MAINNET_UTIL_CONTRACT : (await KV.getString(SCAN_UTIL_CONTRACT, ''))
        return utilContract;
    }
    logCount = 300
    async handleCfxTransferAddress(data:RedisStreamMessage[]) {
        let count = 0
        for (const item of data) {
            const {message: ids} = item
            const hexList = await Hex40Map.findAll({where: {id:{[Op.in]: ids}}})
            for (const hexBean of hexList) {
                await Promise.all([
                    this.cfxWatcher.queryBalance('0x'+hexBean.hex, hexBean.id)
                    ])
            }
            count += hexList.length
        }
        if (this.logCount > 0) {
            console.log(`batch balance watcher handleTokenTransferAddress count ${count}`)
            this.logCount --
        }
        return RedisWrap.xDel(data)
    }

    // xadd TRANSFER_ADDRESS_Q * v1 [1,2]
    async listenTransfer() {
        // should be removed
        RedisWrap.listenStreamMessage(
            TRANSFER_ADDRESS_Q,
            (data) => this.handleCfxTransferAddress(data)
        ).then()
        return RedisWrap.listenStreamMessage(
            CFX_TRANSFER_ADDRESS_Q,
            (data) => this.handleCfxTransferAddress(data)
        )
    }

    public static async getBalances(account:string, tokens:string[]) {
        let banList = await BatchBalanceWatcher.allTokenContract.getBalances(account, tokens)
        return banList
    }
}
