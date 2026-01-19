import {FullBlock, loadMaxBlockEpoch} from "../model/FullBlock";
import {Epoch} from "../model/Epoch";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {CFX_TRANSFER_DELAY, ERC20_TRANSFER_DELAY, KV} from "../model/KV";
import {init} from "../service/tool/FixDailyTokenStat";
import {ConfigInstance, loadConfig} from "../config/StatConfig";
import {StatApp} from "../StatApp";
import {getAppEntryName} from "../service/tool/LoggerConfig";

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
        setTimeout(repeat, 60*1000 * 10) // 10 minutes

    }


}
export async function dingMsg(msg:string, dingTalkToken:string) {
    try {
        await dingMsgRaw(msg, dingTalkToken);
    } catch (e) {
        console.log(`${__filename} failed to send ding`, e);
    }
}
async function dingMsgRaw(msg:string, dingTalkToken:string) {
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
                "content": `${msg}\n[scan ${StatApp.networkId ? StatApp.networkId : ''}] ${ConfigInstance.serverTag} , [${getAppEntryName()}]`
            }
        }).then(res=>{
            console.log(`send ding message done, success:`, res.ok);
        })
        .catch(err=>{
            console.log(`send ding message fail: ${err}`);

        })
}
const OK = 'ok';
export class StuckChecker {
    name: string;

    key: string;
    beginTime: Date;

    minuteThreshold: number;
    readonly msThreshold: number;

    times: number;
    lastAlertTime: Date;
    alertTimes: number;

    constructor(name: string, minuteThreshold:number = 5) {
        this.name = name;
        this.minuteThreshold = minuteThreshold;
        this.msThreshold = minuteThreshold * 60 * 1000;

        this.reset(0);
    }

    reset(times: number) {
        this.times = times;
        this.lastAlertTime = null;
        this.alertTimes = 0;
        this.beginTime = times > 0 ? new Date() : null;
    }
    ok() {
        if (this.alertTimes == 0) {
            return;
        }
        const alertToken = this.getAlertToken();
        dingMsg(`This alert was resolved.\n${this.name}\n${this.key}`, alertToken).then();
        this.key = OK;
        this.reset(0);
    }
    push(key: string) {
        try {
            this.pushUnsafe(key)
        } catch (e) {
            console.log(`${__filename} failed to push error entry:`, e);
        }
    }
    private pushUnsafe(newKey: string) {
        if (this.key == newKey) { // duplicate key, check alert
            this.check();
        } else {
            this.reset(1);
            this.key = newKey;
        }
    }

    private getAlertToken() {
        return ConfigInstance.dingDevToken;
    }

    private check() {
        this.times += 1;
        if (Date.now() - this.beginTime.getTime() < this.msThreshold) {
            return;
        }
        let msg = ''
        if (this.lastAlertTime) {
            if (Date.now() - this.lastAlertTime.getTime() > 3600 * 1000) {
                this.alertTimes += 1;
                this.lastAlertTime = new Date();
                msg = `This alert is unresolved. Alerted for ${this.alertTimes} times.`
                this.sendAlert(msg);
            }
        } else {
            this.alertTimes = 1;
            this.lastAlertTime = new Date();
            msg = `There was an error for ${this.minuteThreshold} minutes.`;
            this.sendAlert(msg);
        }
    }

    private sendAlert(msg: string) {
        const alertToken = this.getAlertToken();
        dingMsg(`${msg}\nChecker: ${this.name
        }\nContent: ${this.key}`, alertToken).then();
    }
}

async function testStuckAlert() {
    const stuck = new StuckChecker("test-stuck-name", 1);
    stuck.push('error message here');

    stuck.beginTime.setMinutes(stuck.beginTime.getMinutes() - 10);
    stuck.push('error message here');

    stuck.lastAlertTime.setHours(stuck.lastAlertTime.getHours() - 10);
    stuck.push('error message here');

    stuck.beginTime.setHours(stuck.beginTime.getHours() - 10);
    stuck.push('error message here');

    stuck.ok();
    stuck.ok();
    stuck.ok();
}

async function main() {
    const [,,dingKey] = process.argv;
    if (!dingKey) {
        console.log(`need ding key`)
        return
    }
    if (dingKey === 'test-stuck') {
        loadConfig('Prod');
        await testStuckAlert();
        return;
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
