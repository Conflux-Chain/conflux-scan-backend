import {StatApp} from "../StatApp";
import {TokenQuery} from "./TokenQuery";
import {Contract} from "../model/Contract";
import {toBase32} from "./tool/AddressTool";

export class TokenSecurityAuditSync{
    private readonly app;

    constructor(app: StatApp) {
        this.app = app;
    }

    private async audit(now: Date): Promise<Boolean>{
        const { cfx, tokenQuery, contractQuery } = this.app;

        let response = await TokenQuery.listAddress();
        let addressArray = response?.list;
        for(const base32 of addressArray){
            await tokenQuery.audit({address: base32});
        }
        console.log(`token_security_audit_sync audit start at:${now}, end at:${new Date()}`);

        response = await contractQuery.listAddress();
        addressArray = response?.list;
        for(const address of addressArray){
            const base32 = toBase32(address);
            const runtimeCode = await cfx.getCode(base32);
            if(!runtimeCode || runtimeCode.length <= 2) {
                await Contract.update({destroyed: true}, {where: {base32}});
            }
        }
        console.log(`token_security_audit_sync audit contract start at:${now}, end at:${new Date()}`);

        return Promise.resolve(true);
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
