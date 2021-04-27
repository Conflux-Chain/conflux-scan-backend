import { QueryTypes } from "sequelize";
import {TopBatchIndex} from "../model/TopRecord";
import {FullBlock} from "../model/FullBlock";
const superagent = require('superagent')

export class Monitor{
    dingTalkToken: string;
    serverTag: string;
    preSyncEpoch = 0
    constructor(dingTalkToken:string, serverTag:string) {
        this.dingTalkToken = dingTalkToken;
        this.serverTag = serverTag;
    }
    async getMaxSyncEpoch() : Promise<number> {
        return FullBlock.max('epoch')
    }
    async checkFullBlockSyncRunning() {
        if (this.preSyncEpoch === 0) {
            this.preSyncEpoch = await this.getMaxSyncEpoch()
        } else {
            const max = await this.getMaxSyncEpoch()
            if (max === this.preSyncEpoch) {
                dingMsg(`[scan] ${this.serverTag} FullBlockSync: epoch is not growing, epoch ${max}`
                    , this.dingTalkToken).then()
            }
        }
        const that = this;
        function repeat() {
            that.checkFullBlockSyncRunning()
        }
        setTimeout(repeat, 60*1000) // 1 minute
    }
    async checkRankDelay() {
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
            this.alert(typesDelayed).then()
        }
        const that = this;
        function repeat() {
            that.checkRankDelay()
        }
        setTimeout(repeat, 3600*1000)
    }
    async alert(arr:TopBatchIndex[]) {
        const maxInfo = arr.map(row=>`${row.type} ${row.endTime.toISOString()}`).join('\n')
        const msg = `${this.serverTag} Top rank delay:\n${maxInfo}`
        dingMsg(msg, this.dingTalkToken).then()
    }
}
async function dingMsg(msg:string, dingTalkToken:string) {
    console.log(`pre send msg:${msg}`);
    if (!dingTalkToken) {
        return;
    }
    let url = 'https://oapi.dingtalk.com/robot/send?access_token='+dingTalkToken;
    superagent.post(url,
        {
            "msgtype": "text",
            "text": {
                "content": `${msg}\n[scan]`
            }
        }).then(res=>{
            console.log(`send message done.`, res.ok);
        })
        .catch(err=>{
            console.log(`send ding message fail: ${msg}`);
            
        })
}