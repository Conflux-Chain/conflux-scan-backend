import { QueryTypes } from "sequelize";
import {FullBlock} from "../model/FullBlock";
import {Epoch} from "../model/Epoch";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {CfxTransfer} from "../model/CfxTransfer";
const superagent = require('superagent')

export class Monitor{
    dingTalkToken: string;
    serverTag: string;
    preSyncEpoch = 0
    constructor(dingTalkToken:string, serverTag:string) {
        this.dingTalkToken = dingTalkToken;
        this.serverTag = serverTag;
    }
    async checkDelay(model:any, delaySeconds: number) {
        const maxBean = await model.findOne({order: [['epoch','desc']]})
        if (maxBean === null) {
            return;
        }
        const now = Date.now()
        const delay = (now - (maxBean.createdAt||maxBean.timestamp).getTime())/1000
        if (delay > delaySeconds) {
            const msg = `Table ${model.getTableName()} delay, seconds ${delay} > ${delaySeconds}`;
            console.log(msg)
            await dingMsg(msg, this.dingTalkToken)
        } else {
            console.log(` no delay. ${model.getTableName()}`)
        }
    }

    async checkAllDelay() {
        await this.checkDelay(FullBlock, 60)
        await this.checkDelay(Epoch, 60)
        await this.checkDelay(Erc20Transfer, 60 * 2)
        await this.checkDelay(CfxTransfer, 60)
        const that = this;
        setTimeout(()=>that.checkAllDelay(), 60_000)
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
            } else {
                this.preSyncEpoch = max;
            }
        }
        const that = this;
        function repeat() {
            that.checkFullBlockSyncRunning()
        }
        setTimeout(repeat, 60*1000) // 1 minute

        setTimeout(()=>that.checkAllDelay(), 10_000)
    }


}
export async function dingMsg(msg:string, dingTalkToken:string) {
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
            console.log(`send ding message done, success:`, res.ok);
        })
        .catch(err=>{
            console.log(`send ding message fail: ${msg}`);

        })
}
