import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {Context} from "koa";
import {setAddressInfo} from "../service/ConfigService";
import {TopBatchIndex} from "../model/TopRecord";
import {Hex40Map} from "../model/HexMap";
import {EventBus} from "../service/watcher/EventBus";
import { listAllContract } from "../model/ContractInfo";
import {Token} from "../model/Token";

async function checkLocal(ctx: Context, next) {
    const ip = ctx.request.ip
    if (ip === '127.0.0.1' || ip === '::1'
        || ip.startsWith('172.31.124') || ip === '::ffff:127.0.0.1') {
        await next()
    } else {
        ctx.body = {code: 401, message: `local address only. ${ip}`}
    }
}

export function addDevopsRouter(router: Router<any, {}>, statApp: StatApp) {
    router.get('/devops/test-processTxAddress',
        checkLocal,
        async (ctx) => {
            EventBus.processTxAddress(ctx.request.query.hex)
            ctx.body = {code: 0, message:"OK"}
        }
    )
    router.get('/devops/hexId',async (ctx) => {
        const {hexId} = ctx.request.query
        const bean = await Hex40Map.findByPk(hexId)
        const token = await Token.findOne({where: {hex40id: bean?.id || 0}})
        ctx.body = {hex: bean, token}
    })
    router.get('/devops/set-address-name',
        checkLocal,
        async (ctx) => await setAddressInfo(ctx)
    )
    router.get('/devops/list-contract',
        async (ctx) => {
            const list = await listAllContract()
            ctx.body = {total: list.length, list}
        }
    )

    router.get('/devops/list-rank',
        checkLocal,
        async (ctx) => {
            ctx.body = await TopBatchIndex.findAll({limit: 30, order: [['id', 'desc']]})
        }
    )
    router.get('/devops/table-size',
        checkLocal,
        async (ctx) => {
            ctx.body = {
                code: 0,
                addressCount: await Hex40Map.count({})
            }
        }
    )
    console.log('devops router registered.')
}