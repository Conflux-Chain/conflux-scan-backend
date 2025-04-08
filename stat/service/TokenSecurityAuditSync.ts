import {Token} from "../model/Token";
import {Contract} from "../model/Contract";
import {Op} from "sequelize";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {TokenQuery} from "./TokenQuery";

export class TokenSecurityAuditSync{
    private readonly tokenQuery: TokenQuery;

    constructor({tokenQuery}: {tokenQuery: TokenQuery}) {
        this.tokenQuery = tokenQuery;
    }

    private async audit(recently: boolean = false){
        const tokenQuery = this.tokenQuery;
        const now = new Date()

        const opt: any = {attributes: ['base32'], raw: true}
        if(recently) {
            const minTime = new Date(now)
            minTime.setDate(minTime.getDate() - 1) // Only audit tokens/contracts in the last 24 hours.
            opt.where = {createdAt: {[Op.gte]: minTime}}
        }

        const tokens = await Token.findAll(opt)
        let addresses = tokens?.map(item => (item.base32))
        for(const address of addresses){
            await tokenQuery.audit({address})
        }

        const tokenSet = new Set([...addresses])
        const contracts = await Contract.findAll(opt)
        addresses = contracts?.map(item => (item.base32)).filter(item => (!tokenSet.has(item)))
        for(const address of addresses){
            await tokenQuery.audit({address})
        }

        console.log(`token audit start ${now.toISOString()} end ${new Date().toISOString()} recently ${recently}`)
    }

    public async schedule() {
        const that = this
        async function repeat() {
            await that.audit().catch(err=>{
                safeAddErrorLog('stat-task', 'token-audit', err).then();
                console.log(`token audit fail: `, err)
            })
            setTimeout(repeat, 1000 * 60 * 60) // interval is 1 hour
        }

        repeat().then()
    }


    public async scheduleRecently() {
        const that = this
        async function repeat() {
            await that.audit(true).catch(err=>{
                safeAddErrorLog('stat-task', 'token-audit-recent', err).then();
                console.log(`recently token audit fail: `, err)
            })
            setTimeout(repeat, 1000 * 5)  // interval is 5 sec
        }

        repeat().then()
    }
}

