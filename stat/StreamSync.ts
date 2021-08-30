import {loadConfig, StatConfig} from "./config/StatConfig";
import {
    ERC1155_TRANSFER_Q,
    ERC20_TRANSFER_Q, ERC721_TRANSFER_Q,
    ERC777_TRANSFER_Q, CFX_TRANSFER_Q,
    RedisStreamMessage,
    RedisWrap, TRANSFER_ADDRESS_Q
} from "./service/RedisWrap";
import {AddressErc20Transfer, build20transferList2address, Erc20Transfer, IErc20Transfer} from "./model/Erc20Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "./model/Erc1155Transfer";
import {AddressErc777Transfer, Erc777Transfer} from "./model/Erc777Transfer";
import {AddressErc721Transfer, Erc721Transfer} from "./model/Erc721Transfer";
import {AddressCfxTransfer, CfxTransfer, popPartitionCfxTransfer} from "./model/CfxTransfer";
import {UniqueConstraintError} from "sequelize"

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
            const copies = build20transferList2address(transferArr)
            if (!copies.length) {
                return RedisWrap.xDel(data)
            }
            sendAddressIds(copies).catch(err=>{
                console.log(`send address in transfer error:`, err)
            })
            if (fullT === Erc1155Transfer || fullT === Erc721Transfer) {
                nftService.saveIds(copies).then().catch(err=>{
                    console.log(`save nft id failed`, err)
                })
            }
            return model.bulkCreate(copies, {
                updateOnDuplicate:["createdAt"],
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
        console.log(`handle transfer message fail: ${data[0].stream} ${info}.`)
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
async function sendAddressIds(arr:{fromId:number, toId:number, contractId:number}[]) {
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
    return RedisWrap.sendStreamMessage([...set], TRANSFER_ADDRESS_Q).then(()=>{
        handleTokenTransferWithContract(addressAndContractIdMap).then()
    })
}
// xlen ERC20_TRANSFER_Q
//   XADD ERC20_TRANSFER_Q  * v1 '[{"contractId":16,"fromId":3,"toId":4,"txHashId":0,"value":1,"epoch":0, "createdAt":"2021-01-01 11:22:33", "updatedAt":"2021-01-01 11:22:33"}]'
let logCount = 0
async function handleTokenTransferWithContract(mapContract2addressSet: Map<number,Set<number>>) {
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
        const banList = await BatchBalanceWatcher.allTokenContract.getBalances(addressArr, `0x${contractHex}`)
        console.log(` \n balance list:`, banList)
        const model = new DynamicBalanceModel(contractId)
        let i = 0
        const tasks = []
        for (const addr of existsAddrArr) {
            const t = BalanceWatcher.saveModel(model, existsAddrArr[i], banList[i], false, 0)
            tasks.push(t)
            i++
        }
        await Promise.all(tasks)
        if (logCount < 100) {
            logCount++
            console.log(`\n save balances of contract ${contractId}, count ${existsAddrArr.length
            }, original addresses length: ${addressIds.length}, balance list length ${banList.length}`)
        }
    }
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
import {Token} from "./model/Token";
import {Op} from "sequelize"
import {NftService} from "./service/NftService";
import {DynamicBalanceModel} from "./service/watcher/DynamicBalanceModel";
import {BalanceWatcher} from "./service/watcher/BalanceWatcher";
import {BatchBalanceWatcher} from "./service/watcher/BatchBalanceWatcher";
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
    new BatchBalanceWatcher(cfx,[],null)
    tokenTool = new TokenTool(cfx)
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

    })
}
run().then()
