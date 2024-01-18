import {StatApp} from "../StatApp";
import {TokenQuery} from "./TokenQuery";
import {Contract} from "../model/Contract";
import {toBase32} from "./tool/AddressTool";
import {CONST} from "./common/constant";
import {format} from "js-conflux-sdk";
import {Token} from "../model/Token";

export class TokenSecurityAuditSync{
    private readonly app;

    constructor(app: StatApp) {
        this.app = app;
    }

    private async audit(now: Date): Promise<Boolean>{
        const { tokenQuery } = this.app

        const tokens = await Token.findAll({attributes: ['base32'], raw: true})
        let addresses = tokens?.map(item => (item.base32))
        for(const address of addresses){
            await tokenQuery.audit({address})
        }
        console.log(`token_security_audit_sync audit start at:${now}, end at:${new Date()}`)


        const tokenSet = new Set([...addresses])
        const contracts = await Contract.findAll({attributes: ['base32'], raw: true})
        addresses = contracts?.map(item => (item.base32)).filter(item => (!tokenSet.has(item)))
        for(const address of addresses){
            await tokenQuery.audit({address})
        }
        console.log(`token_security_audit_sync audit contract start at:${now}, end at:${new Date()}`)

        return Promise.resolve(true)
    }

    private async auditToken(base32){
        // const { cfx } = this.app;
        // const account = await cfx.getAccount(base32);
        // const zeroAdmin = account?.admin && (format.hexAddress(account.admin) === CONST.ZERO_ADDRESS) ? true : false;
        //
        // const verifyInfo = await ContractVerify.findOne({where: {base32, verifyResult: true}});
        // const verify = verifyInfo?.verifyResult ? true : false;
        //
        // const hex40id = (await makeId(format.hexAddress(base32))).id;
        // await TokenSecurityAudit.upsert({ hex40id, base32, verify, zeroAdmin });
        // const { tokenQuery } = this.app;
        // await tokenQuery.audit({address: base32});
    }

    public async schedule() {
        const that = this;
        async function repeat() {
            const now = new Date();
            await that.audit(now).catch(err=>{
                console.log(`token_security_audit_sync fail: `, err);
            });
            const delay = 1000 * 60 * 60; // interval is 1 hour
            setTimeout(repeat, delay);
        }

        repeat().then();
    }
}
