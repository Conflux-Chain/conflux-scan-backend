import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {Context} from "koa";
import {setAddressInfo} from "../service/ConfigService";
import {TopBatchIndex} from "../model/TopRecord";
import {Hex40Map} from "../model/HexMap";
import {EventBus} from "../service/watcher/EventBus";
import {fillMethodInfo, listAllContract} from "../model/ContractInfo";
import {Token} from "../model/Token";
import {QueryTypes} from "sequelize";
import {
    BlockRowMark,
    buildTxHigherCondition,
    FullBlock,
    FullTransaction,
    pagingFullTx,
    TxnRowMark
} from "../model/FullBlock";

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
        const token = await Token.findOne({where: {hex40id: bean?.id || 0}}) || {icon:''}
        token.icon = ''
        ctx.body = {hex: bean, token}
    })
    router.get('/devops/sync-max-info',async (ctx) => {
        await Promise.all([
            TxnRowMark.findOne({order:[["id","desc"]], limit: 1}),
            BlockRowMark.findOne({order:[["id","desc"]], limit: 1}),
            FullBlock.findOne({order:[["epoch", "desc"]], limit: 1}),
            FullTransaction.findOne({order:[["epoch", "desc"]], limit: 1}),
        ]).then(arr=>{
            ctx.body = {marks:arr}
        })
    })
    router.get('/devops/db-partition',async (ctx) => {
        const sql = `SELECT TABLE_NAME,PARTITION_NAME,PARTITION_METHOD,PARTITION_EXPRESSION,PARTITION_DESCRIPTION,TABLE_ROWS,CREATE_TIME,UPDATE_TIME
       FROM INFORMATION_SCHEMA.PARTITIONS
       WHERE PARTITION_NAME is not null;`
        const list = await Hex40Map.sequelize.query(sql,{
            type: QueryTypes.SELECT
        })
        ctx.body = {list}
    })
    router.get('/devops/set-address-name',
        checkLocal,
        async (ctx) => await setAddressInfo(ctx)
    )
    router.get('/devops/test-list-tx-with-method',
        async (ctx) => {
            const pageInfo = await pagingFullTx(0)
            const txList = await FullTransaction.findAll({where:buildTxHigherCondition(pageInfo), offset:pageInfo.skip, limit: 10,
                order:[["epoch","desc"],["blockPosition","desc"],["txPosition","desc"]]})
            await fillMethodInfo(txList)
            ctx.body = {list:txList, pageInfo}
        }
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