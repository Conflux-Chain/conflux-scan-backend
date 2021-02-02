import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {Context} from "koa";
import {setAddressInfo} from "../service/ConfigService";

async function checkLocal(ctx: Context, next) {
    const ip = ctx.request.ip
    if (ip === '127.0.0.1' || ip.startsWith('172.31.124') || ip === '::ffff:127.0.0.1') {
        await next()
    } else {
        ctx.body = {code: 401, message: `local address only. ${ip}`}
    }
}

export function addDevopsRouter(router: Router<any, {}>, statApp: StatApp) {
    router.get('/devops/set-address-name',
        checkLocal,
        async (ctx)=> await setAddressInfo(ctx))
    console.log('devops router registered.')
}