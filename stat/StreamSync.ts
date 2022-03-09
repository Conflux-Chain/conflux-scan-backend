const lodash = require('lodash');
import {StatConfig} from "./config/StatConfig";
import {RedisWrap} from "./service/RedisWrap";
import {Erc20Transfer} from "./model/Erc20Transfer";
import {Erc1155Transfer} from "./model/Erc1155Transfer";
import {Erc721Transfer} from "./model/Erc721Transfer";
import {PruneInfo, PruneType} from "./model/PruneInfo";
import {col, fn, Op} from "sequelize"
import {Conflux, format} from 'js-conflux-sdk'
import {init} from "./service/tool/FixDailyTokenStat";
import {idHex40Map, makeIdV} from "./model/HexMap";
import {patchHttpProvider} from "./service/common/utils";
import {TokenTool} from "./service/tool/TokenTool";
import {NftMint, Token} from "./model/Token";
import {NftService} from "./service/NftService";
import {DynamicBalanceModel} from "./service/watcher/DynamicBalanceModel";
import {BalanceWatcher} from "./service/watcher/BalanceWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";
import {StatApp} from "./StatApp";
import {PruneNotifier} from "./service/prune/PruneNotifier";

const CONST = require('./service/common/constant');

const waitUpdateTransferTokens = {
    hex40ids: new Set<number>()
}
export function scheduleTransferUpdater() {
    function repeat() {
        console.log(` updater works `)
        const ids = waitUpdateTransferTokens.hex40ids
        waitUpdateTransferTokens.hex40ids = new Set<number>()
        updateTokenTransferCount(ids.keys(), true).then(()=>{
            setTimeout(repeat, 60_000_0)
        })
    }
    repeat()
}
const tableMap = {
    'ERC20': Erc20Transfer,
    'ERC721': Erc721Transfer,
    'ERC1155': Erc1155Transfer,
}
export async function updateTokenTransferCount(contractIds: IterableIterator<number>, force = false) {
    const tokens = await Token.findAll({
        where: {hex40id: {[Op.in]: [...contractIds]}, type: {[Op.ne]: ''}, auditResult: true},
        attributes: {
            include: ['hex40id', 'transfer', 'base32'],
            exclude: ['icon']
        }
    })
    for (const t of tokens) {
        if (!t.type) {
            continue
        }
        const preTransfer = t.transfer || 0
        if (force || preTransfer < 10_000) {
            // update immediately
            updateTransferCountReal(t).then()
        } else {
            waitUpdateTransferTokens.hex40ids.add(t.hex40id)
        }
    }
}
export async function updateTransferCountReal(t: Token) {
    if (!t) {
        return
    }
    const table = tableMap[t.type]
    if (!table) {
        return
    }
    let x = 0;
    return table.count({
        where: {contractId: t.hex40id}
    }).then(async cnt=>{
        const prunedRows = await getPrunedRowsByToken({type: t.type, hex40id: t.hex40id});
        x = cnt + prunedRows;
        return Token.update({transfer: x}, {
            where: {id: t.id}
        })
    }).then(()=>{
        console.log(` update transfer count of token ${t.name} x ${x} ${t.base32}`)
    })
}

async function getPrunedRowsByToken({type, hex40id}) {
    let pruneType;
    if(type === CONST.TRANSFER_TYPE.ERC20){
        pruneType = PruneType.ERC20_TRANSFER;
    } else if (type === CONST.TRANSFER_TYPE.ERC721){
        pruneType = PruneType.ERC721_TRANSFER;
    } else if (type === CONST.TRANSFER_TYPE.ERC1155){
        pruneType = PruneType.ERC1155_TRANSFER;
    } else {
        return 0;
    }
    const pruneInfo = await PruneInfo.findOne({where: {addressId: hex40id, type: pruneType}});
    return pruneInfo !== null ? pruneInfo.pruned : 0;
}

// xlen ERC20_TRANSFER_Q
//   XADD ERC20_TRANSFER_Q  * v1 '[{"contractId":16,"fromId":3,"toId":4,"txHashId":0,"value":1,"epoch":0, "createdAt":"2021-01-01 11:22:33", "updatedAt":"2021-01-01 11:22:33"}]'
let logCount = 0

/**
 * Automatically generate holder count for token.
 */
export async function handleTokenTransferWithContract(mapContract2addressSet: Map<number,Set<number>>, showLog = true) {
    console.log(`handleTokenTransferWithContract, size ${mapContract2addressSet.size}`)
    for (const contractId of mapContract2addressSet.keys()) {
        const addressIds = [...mapContract2addressSet.get(contractId)]
        const id2hexMap = await idHex40Map([contractId, ...addressIds])
        const contractHex = id2hexMap.get(contractId)
        if (!contractHex) {
            console.log(`WANING, contract hex not found, contractId id ${contractId}`)
            continue
        }
        const existsAddrArr = addressIds.filter(id=>id2hexMap.get(id))
        if (!existsAddrArr.length) {
            console.log(`WANING, addresses are empty, original ids ${addressIds.join(',')}`)
            continue
        }
        console.log(`find all address : ${existsAddrArr.length === addressIds.length}`)
        const addressArr = existsAddrArr.map(id=>id2hexMap.get(id)).map(h=>`0x${h}`);
        const contractHex40 = `0x${contractHex}`;
        const model = new DynamicBalanceModel(contractId)
        let banList = [];
        await fetchAll(addressArr, contractHex40, banList)
        const allIsZeroFromContract = banList.filter(Boolean).length === 0
        if (allIsZeroFromContract) {
            console.log(` util returns all zero, ${contractHex40}, `, banList.join(','))
            const list = await fetchNftBalanceFromDB(contractId, addressIds);
            if (list.length === 0) {
                // should have at least one record. otherwise code below will clear associated holder.
                console.log(`nft balance from db return 0 record. skip. ${contractHex40}`)
                continue;
            }
            const dbHits = new Set<number>();
            for (let nftMint of list) {
                console.log(`user ${nftMint.toId} holds ${nftMint['count']} of ${contractHex40}`)
                await BalanceWatcher.saveModel(model, nftMint.toId, nftMint['count'], false, 0)
                dbHits.add(nftMint.toId)
            }
            for (let hexId of addressIds) {
                if (dbHits.has(hexId)) {
                    continue
                }
                console.log(`user ${hexId} holds 0 of ${contractHex40}`)
                await BalanceWatcher.saveModel(model, hexId, 0, false, 0)
            }
            console.log(` compute nft balance from DB, ${contractHex40} list length ${list.length}`)
        } else {
            console.log(`util returns balance list ${banList.join(',')} of ${contractHex40}`)
            let i = 0
            const tasks = []
            for (const addr of existsAddrArr) {
                console.log(`user ${addr} holds ${banList[i]} of ${contractHex40}`)
                const t = BalanceWatcher.saveModel(model, addr, banList[i], false, 0)
                tasks.push(t)
                i++
            }
            await Promise.all(tasks)
            console.log(`save balances of contract ${contractHex40}, count ${existsAddrArr.length}`)
        }
    }
}
async function fetchNftBalanceFromDB(contractId: number, addressIds: number[]) {
    return NftMint.findAll({
        attributes: [
            'toId', 'contractId',
            [fn('count', col('*')), 'count']
        ],
        where: {contractId, toId: {[Op.in]: addressIds}},
        raw: true, group: ['toId'],
        // logging: console.log,
    });
}
async function fetchAll(addressArr, contractHex40, result:any[]) {
    let size = 100;
    do {
        const chunks2d: any[][] = lodash.chunk(addressArr, size);
        for (let ids of chunks2d) {

            try {
                const banList = await BatchBalanceWatcher.allTokenContract.getBalances(ids, contractHex40);
                result.push(...banList);
            } catch (e) {
                console.log(` call balance utils contract fail, batch size ${size}, \n [${
                    addressArr.map(addr => format.address(addr, StatApp.networkId)).map(s => `"${s}"`).join('\n')
                }] \n contract ${format.address(contractHex40, StatApp.networkId)}`, e)
                size = Math.floor(size / 2)
                break;
            }

        }
        break;
    } while (size > 0)
}
async function setupZeroAddressId() {
    const zeroHex = '0x'+'0'.padStart(40, '0')
    zeroAddrId = await makeIdV(zeroHex)
}

let config:StatConfig
let nftService:NftService
let zeroAddrId = 0
let cfx:Conflux
let tokenTool:TokenTool
async function run() {
    config = await init()
    nftService = new NftService()
    await setupZeroAddressId()
    cfx = new Conflux(config.conflux)
    await cfx.updateNetworkId()
    patchHttpProvider(cfx, config.conflux)
    // init contract
    // @ts-ignore
    StatApp.networkId = (await cfx.getStatus()).networkId
    console.log(` network id ${StatApp.networkId}`)
    new BatchBalanceWatcher(cfx, null, await BatchBalanceWatcher.getUtilContractAddr())
    if (args[0] === 'test') {
        const addr = ['','']
        const contract = ''
        const list = await BatchBalanceWatcher.allTokenContract.getBalances(addr, contract)
        console.log(` balance list is `, list)
        return
    }
    //
    tokenTool = new TokenTool(cfx)
    PruneNotifier.SWITCH_SYNC_PRUNE = config.syncPrune;
    RedisWrap.connect(config.redis).then(()=>{
    }).then(()=>{
        return scheduleTransferUpdater()
    })
}
const args = process.argv.slice(2)
if (require.main === module) {
    run().then()
    process.on('SIGINT', ()=>process.exit(0));
    process.on('SIGTERM', ()=>process.exit(0));
}
