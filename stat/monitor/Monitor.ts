import { QueryTypes } from "sequelize";
import {FullBlock} from "../model/FullBlock";
import {Epoch} from "../model/Epoch";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {CfxTransfer} from "../model/CfxTransfer";
import {CFX_TRANSFER_DELAY, ERC20_TRANSFER_DELAY, KV} from "../model/KV";
const superagent = require('superagent')

export async function dingMsg(msg:string, dingTalkToken:string) {
    console.log(`pre send msg:${msg}`);
    if (!dingTalkToken) {
        return;
    }
    let url = 'https://oapi.dingtalk.com/robot/send?access_token='+dingTalkToken;
    return superagent.post(url,
        {
            "msgtype": "text",
            "text": {
                "content": `${msg}\n[scan]`
            }
        }).then(res=>{
            console.log(`send ding message done, success:`, res.ok);
        })
        .catch(err=>{
            console.log(`send ding message fail: ${msg}`);

        })
}
