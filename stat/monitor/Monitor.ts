import {FullBlock, loadMaxBlockEpoch} from "../model/FullBlock";
import {Epoch} from "../model/Epoch";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {CFX_TRANSFER_DELAY, ERC20_TRANSFER_DELAY, KV} from "../model/KV";
import {init} from "../service/tool/FixDailyTokenStat";
import {ConfigInstance} from "../config/StatConfig";
import {StatApp} from "../StatApp";
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
            const msg = `${this.serverTag} Table ${model.getTableName()
            }, no data on chain OR sync delay, seconds ${delay} > ${delaySeconds}`;
            console.log(msg)
            await dingMsg(msg, this.dingTalkToken)
        } else {
            console.log(` no delay. ${model.getTableName()}`)
        }
    }

    async checkAllDelay() {
        const [delay20, delayCfx] = await Promise.all([
            KV.getString(ERC20_TRANSFER_DELAY,'120').then(parseInt),
            KV.getString(CFX_TRANSFER_DELAY,'120').then(parseInt),
        ])
        await this.checkDelay(FullBlock, 60)
        await this.checkDelay(Epoch, 60)
        await this.checkDelay(Erc20Transfer, delay20)
        // await this.checkDelay(CfxTransfer, delayCfx)
    }
    async checkFullBlockSyncRunning() {
        if (this.preSyncEpoch === 0) {
            this.preSyncEpoch = await loadMaxBlockEpoch()
        } else {
            const max = await loadMaxBlockEpoch()
            if (max === this.preSyncEpoch) {
                dingMsg(`[scan] ${this.serverTag} FullBlockSync: epoch is not growing, epoch ${max}`
                    , this.dingTalkToken).then()
            } else {
                this.preSyncEpoch = max;
            }
        }
        const that = this;
        that.checkAllDelay().then();
        function repeat() {
            that.checkFullBlockSyncRunning()
        }
        setTimeout(repeat, 60*1000 * 10) // 10 minute

    }


}
export async function dingMsg(msg:string, dingTalkToken:string) {
    console.log(`pre send msg:${msg}`);
    if (!dingTalkToken) {
        console.log(`ding talk token is not set`)
        return;
    }
    let url = 'https://oapi.dingtalk.com/robot/send?access_token='+dingTalkToken;
    return superagent.post(url,
        {
            "msgtype": "text",
            "text": {
                "content": `${msg}\n[scan ${StatApp.networkId}] ${ConfigInstance.serverTag}`
            }
        }).then(res=>{
            console.log(`send ding message done, success:`, res.ok);
        })
        .catch(err=>{
            console.log(`send ding message fail: ${err}`);

        })
}

async function main() {
    const [,,dingKey] = process.argv;
    if (!dingKey) {
        console.log(`need ding key`)
        return
    }
    const cfg = await init();
    if (process.argv.includes("test")) {
        await dingMsg("this is a test message from "+ cfg.serverTag, dingKey)
    }
    const m = new Monitor(dingKey, cfg.serverTag);
    m.checkFullBlockSyncRunning().then()
}

if (module == require.main) {
    main().then()
}
