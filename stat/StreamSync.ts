const lodash = require('lodash');
import {loadConfig, StatConfig} from "./config/StatConfig";
import {
    ERC1155_TRANSFER_Q,
    ERC20_TRANSFER_Q, ERC721_TRANSFER_Q,
    ERC777_TRANSFER_Q, CFX_TRANSFER_Q,
    RedisStreamMessage,
    RedisWrap, TRANSFER_ADDRESS_Q
} from "./service/RedisWrap";
import {AddressErc20Transfer, buildTransferList2address, Erc20Transfer, IErc20Transfer} from "./model/Erc20Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {AddressErc777Transfer, Erc777Transfer} from "./model/Erc777Transfer";
import {AddressErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressCfxTransfer, CfxTransfer, popPartitionCfxTransfer} from "./model/CfxTransfer";
import {PruneInfo, PruneType} from "./model/PruneInfo";
import {UniqueConstraintError, fn, col} from "sequelize"
import {format} from 'js-conflux-sdk'
const CONST = require('./service/common/constant');

async function handleTokenTransfer(fullT:any, model:any, data:RedisStreamMessage[]) {
    // console.log(`handleTokenTransfer `, data.length)
    const list:any[] = data.map(msg=>msg.message)
    return Promise.all(
        list.map(transferArr=>{
            // console.log(`receive message: `, transferArr)
            if (transferArr.action === 'pop') {
                return popPartition(transferArr.epoch, fullT, model).then(()=>{
                    return RedisWrap.xDel(data)
                });
            }
            if (transferArr.action === 'popCfxTransfer') {
                return popPartitionCfxTransfer(transferArr.epoch).then(()=>{
                    return RedisWrap.xDel(data)
                });
            }
            const copies = buildTransferList2address(transferArr)
            if (!copies.length) {
                return RedisWrap.xDel(data)
            }
            setImmediate(()=>sendAddressIds(fullT, copies).catch(err=>{
                console.log(`send address in transfer error:`, err)
            }))
            if (fullT === Erc1155Transfer || fullT === Erc721Transfer) {
                nftService.saveIds(copies).then().catch(err=>{
                    console.log(`save nft id failed`, err)
                })
            }
            return model.bulkCreate(copies, {
                updateOnDuplicate:["createdAt", 'epoch'],
            })
                .catch(err=>{
                    const epoch = copies[0].epoch
                    if (err instanceof UniqueConstraintError) {
                        console.log(`We know and ignore this error: ${err} \n sql ${err.sql}`)
                        StreamErrorLog.create({message: `${JSON.stringify({epoch, sql: err.sql})}`,
                           remark:null, id:null })
                        return []
                    }
                    throw err
                })
            .then(arr=>{
                console.log(` ${new Date().toISOString()} bulk create transfer ${model.getTableName()} ${arr.length}    `)
                return arr
            }).then(()=>{
                return RedisWrap.xDel(data)
            }).then(()=>{
                checkTotalSupply(fullT, copies).catch(err=>{
                    console.log(`checkTotalSupply fail:`, err)
                })
            });
        })
    ).catch(err=>{
        const info = data.map(msg=>msg.messageId).join(',')
        console.log(`\n handle transfer message fail: ${data[0].stream} ${info}.`)
        dingMsg(`[${config.serverTag}] handle transfer message fail: ${data[0].stream}: ${err}`, config.dingTalkToken)
        throw err;
    })
}
async function checkTotalSupply(model, copies:IErc20Transfer[]) {
    if (model === Erc20Transfer || model === Erc721Transfer ) {
    } else {
        // console.log(`not match ${model.getTableName()}`)
        return
    }
    const contractSet = new Set<number>()
    copies.forEach(t=>{
        // console.log(`from ${t.fromId} to ${t.toId}, zero ${zeroAddrId}`)
        if (t.fromId === zeroAddrId || t.toId === zeroAddrId){
            contractSet.add(t.contractId)
        }
    })
    if (contractSet.size === 0) {
        // console.log(`zero contract set.`)
        return
    }
    const tokenList = await Token.findAll({where:{
            hex40id: { [Op.in]: [...contractSet]}
        }})
    // console.log(`token list length ${tokenList.length}`)
    for (const token of tokenList) {
        const sup = await tokenTool.getTokenTotalSupply(token.base32)
        if (sup === undefined) {
            console.log(`\n supply undefined, ${token.symbol}`)
            continue
        }
        const [cnt] = await Token.update({totalSupply: sup},{
            where: {id: token.id}
        })
        console.log(`\n update total supply ${sup}, db updated ${cnt} for ${token.symbol}`)
    }
}
async function sendAddressIds(model, arr:{fromId:number, toId:number, contractId:number}[]) {
    const set = new Set<number>()
    // key: contract id, value: set of address id
    const addressAndContractIdMap = new Map<number,Set<number>>()
    arr.forEach(item=>{
        set.add(item.fromId)
        set.add(item.toId)
        let adSet = addressAndContractIdMap.get(item.contractId)
        if (!adSet) {
           adSet = new Set<number>()
            addressAndContractIdMap.set(item.contractId, adSet)
        }
        adSet.add(item.fromId)
        adSet.add(item.toId)
    })
    PruneNotifier.notifyTokenTransfer(model, addressAndContractIdMap)
        .catch(e => console.log(`stream-sync.noticePruneTransfer`, e));
    handleTokenTransferWithContract(addressAndContractIdMap).then()
    updateTokenTransferCount(addressAndContractIdMap.keys()).then()
}
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
 * @param mapContract2addressSet
 */
export async function handleTokenTransferWithContract(mapContract2addressSet: Map<number,Set<number>>, showLog = true) {
    for (const contractId of mapContract2addressSet.keys()) {
        const addressIds = [...mapContract2addressSet.get(contractId)]
        const id2hexMap = await idHex40Map([contractId, ...addressIds])
        const contractHex = id2hexMap.get(contractId)
        if (!contractHex) {
            console.log(`\n handleTokenTransferWithContract, contract hex not found, id ${contractId}`)
            continue
        }
        const existsAddrArr = addressIds.filter(id=>id2hexMap.get(id))
        if (!existsAddrArr.length) {
            console.log(`\n addresses are empty, original ids ${addressIds.join(',')}`)
            continue
        }
        const addressArr = existsAddrArr.map(id=>id2hexMap.get(id)).map(h=>`0x${h}`);
        const contractHex40 = `0x${contractHex}`;
        const model = new DynamicBalanceModel(contractId)
        let banList = [];
        await fetchAll(addressArr, contractHex40, banList)
        const allIsZeroFromContract = banList.filter(Boolean).length === 0
        if (allIsZeroFromContract) {
            console.log(` util returns all zero, ${contractHex40}, `, banList)
            const list = await fetchNftBalanceFromDB(contractId, addressIds);
            if (list.length === 0) {
                // should have at least one record. otherwise code below will clear associated holder.
                console.log(`nft balance from db return 0 record. skip.`)
                return;
            }
            const dbHits = new Set<number>();
            for (let nftMint of list) {
                await BalanceWatcher.saveModel(model, nftMint.toId, nftMint['count'], false, 0)
                dbHits.add(nftMint.toId)
            }
            for (let hexId of addressIds) {
                if (dbHits.has(hexId)) {
                    continue
                }
                await BalanceWatcher.saveModel(model, hexId, 0, false, 0)
            }
            if (showLog && logCount < 100) {
                logCount++
                console.log(` compute nft balance from DB, list length ${list.length}`)
            }
            return;
        }
        showLog && console.log(`balance list:`, banList.length)
        // showLog && console.log(` address `, addressArr.join(','), '\ncontract', contractHex40)
        let i = 0
        const tasks = []
        for (const addr of existsAddrArr) {
            const t = BalanceWatcher.saveModel(model, existsAddrArr[i], banList[i], false, 0)
            tasks.push(t)
            i++
        }
        await Promise.all(tasks)
        if (showLog && logCount < 100) {
            logCount++
            console.log(`\n save balances of contract ${contractId}, count ${existsAddrArr.length
            }, original addresses length: ${addressIds.length}, balance list length ${banList.length}`)
        }
    }
}
async function fetchNftBalanceFromDB(contractId: number, addressIds: number[]) {
    const list = await NftMint.findAll({
        attributes: [
            'toId', 'contractId',
            [fn('count', col('*')), 'count']
        ],
        where: {contractId, toId: {[Op.in]:addressIds}},
        raw: true, group: ['toId'],
        // logging: console.log,
    })
    return list;
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
import {init} from "./service/tool/FixDailyTokenStat";
import {dingMsg} from "./monitor/Monitor";
import {popPartition} from "./model/ErcTransfer";
import {StreamErrorLog} from "./model/ErrorLog";
import {Hex40Map, idHex40Map, makeIdV} from "./model/HexMap";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "./service/common/utils";
import {TokenTool} from "./service/tool/TokenTool";
import {NftMint, Token} from "./model/Token";
import {Op} from "sequelize"
import {NftService} from "./service/NftService";
import {DynamicBalanceModel} from "./service/watcher/DynamicBalanceModel";
import {BalanceWatcher} from "./service/watcher/BalanceWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";
import {StatApp} from "./StatApp";
import {PruneNotifier} from "./service/prune/PruneNotifier";
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
        RedisWrap.listenStreamMessage(
            ERC20_TRANSFER_Q,
            (data)=>handleTokenTransfer(Erc20Transfer, AddressErc20Transfer,data)
        );
        RedisWrap.listenStreamMessage(
            ERC721_TRANSFER_Q,
            (data)=>handleTokenTransfer(Erc721Transfer, AddressErc721Transfer,data)
        );
        RedisWrap.listenStreamMessage(
            ERC777_TRANSFER_Q,
            (data)=>handleTokenTransfer(Erc777Transfer, AddressErc777Transfer,data)
        );
        RedisWrap.listenStreamMessage(
            ERC1155_TRANSFER_Q,
            (data)=>handleTokenTransfer(Erc1155Transfer, AddressErc1155Transfer,data)
        );
        // cfx transfer doesn't trigger this, it's saved directly to db.
        RedisWrap.listenStreamMessage(
            CFX_TRANSFER_Q,
            (data)=>handleTokenTransfer(CfxTransfer, AddressCfxTransfer,data)
        );
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
