import {Token} from "../model/Token";
import {Contract} from "../model/Contract";
import {Op} from "sequelize";

export class TokenSecurityAuditSync{
    private readonly app

    constructor(app: any) {
        this.app = app
    }

    private async audit(recently: boolean = false){
        const { tokenQuery } = this.app

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
                console.log(`recently token audit fail: `, err)
            })
            setTimeout(repeat, 1000 * 5)  // interval is 5 sec
        }

        repeat().then()
    }
}

