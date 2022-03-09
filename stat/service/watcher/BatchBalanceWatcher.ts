// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {abi} from "./contract/BatchBalanceOf";
import {CfxWatcher} from "./BalanceWatcher";
import {Hex40Map, idHex40Map, makeId, makeIdV} from "../../model/HexMap";
import {StatApp} from "../../StatApp";
import {BALANCE_UTIL_ABI} from "./contract/BalanceUtilAbi";
import {Op} from 'sequelize'
import {hex} from "../../test/GenData";
import {DynamicBalanceModel} from "./DynamicBalanceModel";
import {KV, SCAN_UTIL_CONTRACT} from "../../model/KV";
import {TokenTool} from "../tool/TokenTool";
import {NftMint, Token} from "../../model/Token";
import {handleTokenTransferWithContract, scheduleTransferUpdater, updateTokenTransferCount} from "../../StreamSync";
import {ContractUser} from "../../model/Erc20Transfer";
import {patchHttpProvider} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {sleep} from "../tool/ProcessTool";

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

    public static async getBalances(account:string, tokens:string[]) {
        let banList = await BatchBalanceWatcher.allTokenContract.getBalances(account, tokens).catch(err=>{
            console.log(` getBalances fail: `, err.data)
            console.log(` getBalances fail: `, err)
        })
        return banList
    }
}
// ---
let zeroAddrId = 0
async function run() {
    const [,,url,limitStr] = process.argv;
    const cfx = new Conflux({url});
    patchHttpProvider(cfx, {url})
    await cfx.updateNetworkId();
    await init();
    const zeroHex = '0x'+'0'.padStart(40, '0')
    zeroAddrId = await makeIdV(zeroHex)
    const st = await cfx.getStatus()
    StatApp.networkId = st.networkId;
    const utilContract = await BatchBalanceWatcher.getUtilContractAddr();
    new BatchBalanceWatcher(cfx, null, utilContract)
    console.log(`-------------network ${st.networkId}------${utilContract}------`)
    scheduleTransferUpdater();
    const limit = limitStr ? parseInt(limitStr) : 10_000
    while(true) {
        const cnt = await processContractUser(cfx, limit)
        if (cnt === 0) {
            await sleep(5_000);
        }
    }
}
// should check rpc epoch, and only delete confirmed records.
// in case the sync process uses a rpc with higher epoch than this program.
async function processContractUser(cfx:Conflux, limit:number) {
    const list = await ContractUser.findAll({
        order: [['id', 'asc']], limit
    })
    if (list.length === 0) {
        console.log(` ${new Date().toISOString()} empty contract user table .`)
        return 0;
    }
    // const maxDbId = await ContractUser.findOne({order:[['id','desc']]}).then(res=>res.id)
    const [{id:minId}] = list;
    const maxId = list[list.length - 1].id
    // if (maxDbId - maxId < 10) {
    // }
    const ms = Date.now();
    console.log(`${new Date().toISOString()} process ${minId}, ${maxId}, count ${list.length} begin.`)
    try {
        await addTransferInfo(list, cfx);
    } catch (e) {
        console.log(` process fail . `, e)
        return 0;
    }
    const confirmedEpoch = await cfx.getEpochNumber('latest_confirmed');
    const delCnt = await ContractUser.destroy({where: {
        id: {[Op.in]:list.map(u=>u.id)}, epoch: {[Op.lte]: confirmedEpoch}
    }});
    const hasUnconfirmed = list.find(r=>r.epoch>confirmedEpoch);
    if (hasUnconfirmed) {
        console.log(`hasUnconfirmed, wait a moment`)
        await sleep(5_000)
    }
    const elapse = Date.now() - ms;
    const avg = (elapse / list.length).toPrecision(5)
    console.log(`${new Date().toISOString()} process contract user, count ${list.length
    },  deleted ${delCnt}, [${minId},${maxId}], avg ${avg}ms.`)
}
let tokenTool:TokenTool
// update total supply and holder balance.
export async function addTransferInfo(arr:{fromId:number, toId:number, contractId:number}[], cfx:Conflux) {
    const transferInfoMap = new Map<number, Set<number>>()
    arr.forEach(item=>{
        let adSet = transferInfoMap.get(item.contractId)
        if (!adSet) {
            adSet = new Set<number>()
            transferInfoMap.set(item.contractId, adSet)
        }
        item.fromId !== zeroAddrId && adSet.add(item.fromId)
        item.toId !== zeroAddrId && adSet.add(item.toId)
    });
    const map = transferInfoMap;
    await updateTotalSupply(cfx, [...map.keys()])
    console.log(` ---`)
    await handleTokenTransferWithContract(map, cfx)
    console.log(` ---`)
    await updateTokenTransferCount(map.keys(), false)
}
async function updateTotalSupply(cfx:Conflux, contractIds:number[]) {
    if (!tokenTool) {
        tokenTool = new TokenTool(cfx)
    }
    for (let i = 0; i < contractIds.length; i++) {
        let cid = contractIds[i];
        let hexBean: Hex40Map;
        try {
            hexBean = await Hex40Map.findByPk(cid);
            let sup = await tokenTool.getTokenTotalSupply('0x'+hexBean.hex)
            if (!sup) {
                sup = await NftMint.count({where: {contractId: cid}})
                console.log(` updateTotalSupply, nft count for 0x${hexBean.hex} id ${cid} is ${sup}`)
                if (!sup) {
                    continue;
                }
            }
            const [cnt] = await Token.update({totalSupply: sup}, {
                where: {hex40id: cid},
                // logging: console.log,
            });
            console.log(` update total supply affect ${cnt}, sup ${sup} cid ${cid} hex 0x${hexBean.hex}`)
        } catch (e) {
            console.log(`update token total supply fail, 0x${hexBean.hex}:`, e)
        }
    }
}

if (require.main === module) {
    run().then()
}