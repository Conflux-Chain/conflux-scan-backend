import {Conflux} from "js-conflux-sdk";
import {IPivotSwitch, PivotSwitch} from "../../../model/Block";
import {fmtDtUTC} from "../../../model/Utils";
const superagent = require("superagent")
export class ChainWatcher{
    private ws: Conflux;
    private latest_epoch = 0
    private latest_confirmed: number = 0;
    private latest_state: number = 0;
    async watchPivotSwitch({cfxWsUrl}) {
        if (cfxWsUrl === '') {
            return;
        }
        this.ws = new Conflux({url: cfxWsUrl});
        const subscription = await this.ws.subscribeEpochs().catch(err=>{
            console.log(`subscribe epoch fail, from ${cfxWsUrl}:`, err)
            return null;
        })
        if (subscription === null) {
            return
        }
        // @ts-ignore
        subscription.on('data', async data => {
            //
            let epoch = data.epochNumber
            // console.log(`epoch ${epoch} produced`)
            if (epoch <= this.latest_epoch) {
                let bean = {high: this.latest_epoch, low: epoch,
                    preExecuted: this.latest_state,
                    preConfirmed: this.latest_confirmed,
                    revertExecuted: epoch <= this.latest_state,
                    revertConfirmed: epoch <= this.latest_confirmed,
                    revertDepth: this.latest_epoch - epoch
                };
                PivotSwitch.create(bean).then()
                console.log(`${ fmtDtUTC(new Date()) } chain reorg of depth ${this.latest_epoch - epoch} (${this.latest_epoch} --> ${epoch})`);
                this.sendNotify(bean)
            }
            this.latest_epoch = epoch;
            this.latest_confirmed = await this.ws.getEpochNumber("latest_confirmed");
            this.latest_state = await this.ws.getEpochNumber("latest_state");
        });
    }

    private sendNotify(bean: IPivotSwitch) {
        const url = 'https://oapi.dingtalk.com/robot/send?access_token=b8a11784c8ff7a458d08a7a6a37237aa93b4fb5794b56f5403553c3c7f2d0d97'
        superagent.post(url)
            .send({
                "msgtype": "text",
                "text": {
                    "content": `Pivot Switch, from${bean.high} to ${bean.low
                    }, diff ${bean.high - bean.low}, \n revert confirmed: ${bean.revertConfirmed
                    }\n revert executed: ${bean.revertExecuted}`
                }
            }).end((err, res)=>{
            err && console.log(`send message, err :` ,err)
        })
    }
}