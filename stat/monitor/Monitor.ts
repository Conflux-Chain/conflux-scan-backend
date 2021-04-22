import { QueryTypes } from "sequelize";
import {TopBatchIndex} from "../model/TopRecord";
const superagent = require('superagent')

export async function checkRankDelay(dingTalkToken:string) {
    // 'rank_address_by_staking','rank_address_by_cfx','rank_address_by_total_cfx'
    const sql = `select max(end_time) as endTime, type from batch_index where type like 'rank_address_by_%' group by type`
    const maxEndTimeByTypeList:TopBatchIndex[] = await TopBatchIndex.sequelize.query(sql, {type:QueryTypes.SELECT})
    const maxInfo = maxEndTimeByTypeList.map(row=>`${row.type} ${row.endTime.toISOString()}`).join('\n')
    console.log(`max end time:\n ${maxInfo}`);
    
    const now = new Date().getTime();
    const daysAgo = now - 1000*3600*24*2//two days
    const typesDelayed = maxEndTimeByTypeList.filter(row=>row.endTime.getTime() < daysAgo)
    if (typesDelayed.length === 0) {
        console.log(`no delay`);
    } else {
        alert(typesDelayed, dingTalkToken)
    }
    setTimeout(checkRankDelay, 3600*1000)
}
async function alert(arr:TopBatchIndex[], dingTalkToken:string) {
    const maxInfo = arr.map(row=>`${row.type} ${row.endTime.toISOString()}`).join('\n')
    const msg = `Top rank delay:\n${maxInfo}`
    dingMsg(msg, dingTalkToken).then()
}
async function dingMsg(msg:string, dingTalkToken:string) {
    console.log(`pre send msg:${msg}`);
    
    let url = 'https://oapi.dingtalk.com/robot/send?access_token='+dingTalkToken;
    superagent.post(url,
        {
            "msgtype": "text",
            "text": {
                "content": `${msg}\n[测试][scan]`
            }
        }).then(res=>{
            console.log(`send message done.`, res.ok);
        })
        .catch(err=>{
            console.log(`send ding message fail: ${msg}`);
            
        })
}