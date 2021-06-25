import {loadConfig, StatConfig} from "./config/StatConfig";
import {
    ERC1155_TRANSFER_Q,
    ERC20_TRANSFER_Q, ERC721_TRANSFER_Q,
    ERC777_TRANSFER_Q, CFX_TRANSFER_Q,
    RedisStreamMessage,
    RedisWrap, TRANSFER_ADDRESS_Q
} from "./service/RedisWrap";
import {AddressErc20Transfer, build20transferList2address, Erc20Transfer} from "./model/Erc20Transfer";
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
            return model.bulkCreate(copies)
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
                process.stdout.write(`\r\u001b[2K ${new Date().toISOString()} bulk create transfer ${model.getTableName()} ${arr.length}    `)
                return arr
            }).then(()=>{
                return RedisWrap.xDel(data)
            });
        })
    ).catch(err=>{
        const info = data.map(msg=>msg.messageId).join(',')
        console.log(`handle transfer message fail: ${data[0].stream} ${info}.`)
        dingMsg(`[${config.serverTag}] handle transfer message fail: ${data[0].stream}: ${err}`, config.dingTalkToken)
        throw err;
    })
}

async function sendAddressIds(arr:{fromId:number, toId:number}[]) {
    const set = new Set<number>()
    arr.forEach(item=>{
        set.add(item.fromId)
        set.add(item.toId)
    })
    return RedisWrap.sendStreamMessage([...set], TRANSFER_ADDRESS_Q)
}

import {init} from "./service/tool/FixDailyTokenStat";
import {dingMsg} from "./monitor/Monitor";
import {popPartition} from "./model/ErcTransfer";
import {StreamErrorLog} from "./model/ErrorLog";
let config:StatConfig
async function run() {
    config = await init()
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
        RedisWrap.listenStreamMessage(
            CFX_TRANSFER_Q,
            (data)=>handleTokenTransfer(CfxTransfer, AddressCfxTransfer,data)
        );
    }).then(()=>{

    })
}
run().then()
