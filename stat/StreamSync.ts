import {loadConfig, StatConfig} from "./config/StatConfig";
import {
    ERC1155_TRANSFER_Q,
    ERC20_TRANSFER_Q, ERC721_TRANSFER_Q,
    ERC777_TRANSFER_Q,
    RedisStreamMessage,
    RedisWrap
} from "./service/RedisWrap";
import {AddressErc20Transfer, build20transferList2address} from "./model/Erc20Transfer";
import {AddressErc1155Transfer} from "./model/Erc1155Transfer";
import {AddressErc777Transfer} from "./model/Erc777Transfer";
import {AddressErc721Transfer} from "./model/Erc721Transfer";

async function handleTokenTransfer(model:any, data:RedisStreamMessage[]) {
    // console.log(`handleTokenTransfer `, data)
    const list:any[] = data.map(msg=>msg.message)
    return Promise.all(
        list.map(transferArr=>{
            const copies = build20transferList2address(transferArr)
            if (!copies.length) {
                return RedisWrap.xDel(data)
            }
            return model.bulkCreate(copies).then(arr=>{
                process.stdout.write(`\r\u001b[2K ${new Date().toISOString()} bulk create transfer ${arr.length}`)
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
import {init} from "./service/tool/FixDailyTokenStat";
import {dingMsg} from "./monitor/Monitor";
let config:StatConfig
async function run() {
    config = await init()
    RedisWrap.connect(config.redis).then(()=>{
        RedisWrap.listenStreamMessage(
            ERC20_TRANSFER_Q,
            (data)=>handleTokenTransfer(AddressErc20Transfer,data)
        );
        RedisWrap.listenStreamMessage(
            ERC721_TRANSFER_Q,
            (data)=>handleTokenTransfer(AddressErc721Transfer,data)
        );
        RedisWrap.listenStreamMessage(
            ERC777_TRANSFER_Q,
            (data)=>handleTokenTransfer(AddressErc777Transfer,data)
        );
        RedisWrap.listenStreamMessage(
            ERC1155_TRANSFER_Q,
            (data)=>handleTokenTransfer(AddressErc1155Transfer,data)
        );
    }).then(()=>{

    })
}
run().then()