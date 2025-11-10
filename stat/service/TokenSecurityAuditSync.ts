import {Contract} from "../model/Contract";
import {Op} from "sequelize";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {Token} from "../model/Token";
import {TokenQuery} from "./TokenQuery";
import {NameTag} from "../model/NameTag";

export class TokenSecurityAuditSync{
    private readonly tokenQuery: TokenQuery;

    constructor({tokenQuery}: {tokenQuery: TokenQuery}) {
        this.tokenQuery = tokenQuery;
    }

    async scheduleRecently(interval = 1000 * 5) { // default 5s
        return this.schedule(interval, true);
    }

    async scheduleOverall(interval = 1000 * 60 * 60) { // default 1h
        return this.schedule(interval, false);
    }

    private async schedule(interval, recently) {
        const that = this;

        async function repeat() {
            await that.audit(recently).catch(err=>{
                safeAddErrorLog('stat-task', 'token-audit', err).then();
                console.log(`token audit fail: `, err);
            })
            setTimeout(repeat, interval);
        }

        repeat().then();
        console.log(`Token security audit schedule in ${interval/1000}s interval`);
    }

    private async audit(recently: boolean = false){
        const tokenQuery = this.tokenQuery;
        const now = new Date();

        const opt: any = {attributes: ['base32'], raw: true};
        if(recently) { // Audit those whose tokeninfo/nametag have changed from the last 24 hours.
            const minTime = new Date(now);
            minTime.setDate(minTime.getDate() - 1);

            const nameTags = await NameTag.findAll({
                attributes: ['base32'], where: {updatedAt: {[Op.gte]: minTime}}, raw: true,
            } as any);

            const conditions: any[] = [
                {createdAt: {[Op.gte]: minTime}}
            ];

            if (nameTags.length) {
                conditions.push({
                    base32: {[Op.in]: nameTags.map(nameTag => nameTag.base32)}
                });
            }

            opt.where = conditions.length === 1
                ? conditions[0]
                : {[Op.or]: conditions};
        }

        const tokens = await Token.findAll(opt);
        let addresses = tokens?.map(item => (item.base32));
        for(const address of addresses){
            await tokenQuery.audit(address);
        }

        const tokenSet = new Set([...addresses]);
        const contracts = await Contract.findAll(opt);
        addresses = contracts?.map(item => (item.base32)).filter(item => (!tokenSet.has(item)));
        for(const address of addresses){
            await tokenQuery.audit(address);
        }

        !recently && console.log('Token security audit executed', {
            start: now.toISOString(),
            end: new Date().toISOString(),
        });
    }
}

