import * as Router from "koa-router";
const addressSdk = require('js-conflux-sdk/src/util/address')
import {StatApp} from "../StatApp";
import {Context} from "koa";
const proxy = require('koa-proxy');
import {Hex40Map} from "../model/HexMap";
import {AbiInfo, fillMethodInfo, listAllContract} from "../model/ContractInfo";
import {DailyToken, Token} from "../model/Token";
import {QueryTypes} from "sequelize";
import {
    BlockRowMark,
    buildTxHigherCondition,
    FullBlock,
    FullTransaction, pagingFullBlock,
    pagingFullTx,
    TxnRowMark
} from "../model/FullBlock";
import {FullBlockQuery} from "../service/FullBlockQuery";
import {KEY_FULL_BLOCK_COUNT, KEY_FULL_TX_COUNT, KV} from "../model/KV";

import {TxnQuery} from "../service/TxnQuery";
import {Erc20Transfer} from "../model/Erc20Transfer";
import {CfxTransfer} from "../model/CfxTransfer";
// @ts-ignore
import {format} from "js-conflux-sdk";
import {PruneInfo} from "../model/PruneInfo";
import {Epoch} from "../model/Epoch";
import {Erc721Transfer} from "../model/Erc721Transfer";
import {pickNumber} from "../model/Utils";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {BlockAndMinerSync, countRecentMiner} from "../service/BlockAndMinerSync";
import {getClientIP} from "./RateLimiter";
import {ConfigInstance} from "../config/StatConfig";

async function checkLocal(ctx: Context, next) {
    const ip = getClientIP(ctx);
    if (ip === '127.0.0.1' || ip === '::1'
        || ip.startsWith('172.31.124') || ip === '::ffff:127.0.0.1') {
        await next()
    } else {
        ctx.body = {code: 401, message: `local address only. ${ip}`}
    }
}
export async function proxyPath(ctx: any, next:any) {
    // console.log(`------ proxy path `, ctx.url)
    if (!ctx.url.startsWith('/stat/phpmyadmin/')) {
        return next()
    }
    let path = ctx.url.substring('/stat/'.length)
    const p = proxy({
        url:  `http://127.0.0.1:8011/${path}`, // config local nginx to do your job
        host: `http://${ctx.hostname}`,
    })
    await p(ctx,next)
}
export function addDevopsRouter(router: Router<any, {}>, statApp: StatApp) {
    router.post('/devops/rpc-proxy', async (ctx, next)=>{
        const p = proxy({
            url:  'http://127.0.0.1/rpc-proxy', // config local nginx to do your job
            host: `http://${ctx.hostname}`,
        })
        await p(ctx,next)
    });
    router.get('/devops/hexId',async (ctx) => {
        const {hexId} = ctx.request.query
        let bean:Hex40Map
        if (/^\d+$/.test(hexId)) {
            bean = await Hex40Map.findByPk(hexId)
        } else if (hexId.toString().startsWith('0x')) {
            bean = await Hex40Map.findOne({where: {hex: hexId.toString().substr(2)}})
        } else {
            let hex: any;
            try {
                hex = format.hexAddress(hexId);
            } catch (e) {
                ctx.body = {code: 500, msg: `unknown address:[${hexId}]`}
                return
            }
            bean = await Hex40Map.findOne({where: {hex: hex.substr(2)}})
        }
        const token = await Token.findOne({where: {hex40id: bean?.id || 0}}) || {icon:''};
        token.icon = ''
        const base32 = bean ? TxnQuery.base32('0x'+bean.hex, StatApp.networkId) : ''
        ctx.body = {base32, hex0x: '0x'+bean?.hex, id: bean?.id, server: ConfigInstance?.serverTag, hex: bean, token}
    })
    router.get('/devops/sync-max-epoch',async (ctx) => {
        function fillName(res, name) {
            res = res || {createdAt: new Date(), epoch: -1}
            res.name = name
            return res;
        }
        const list = await Promise.all([
            Epoch.findOne({order:[['epoch','desc']], raw:true}).then(res=>fillName(res, 'epoch')),
            Erc20Transfer.findOne({order:[['epoch','desc']], raw:true}).then(res=>fillName(res, 'Erc20transfer')),
            CfxTransfer.findOne({order:[['epoch','desc']], raw:true}).then(res=>fillName(res, 'cfx transfer')),
            FullBlock.findOne({order:[['epoch','desc']], raw:true}).then(res=>fillName(res, 'full block')),
            FullTransaction.findOne({order:[['epoch','desc']], raw:true}).then(res=>fillName(res, 'full tx')),
        ])
        ctx.body = {list};
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
        const sql = `SELECT TABLE_SCHEMA,TABLE_NAME,PARTITION_NAME,PARTITION_METHOD,PARTITION_EXPRESSION,PARTITION_DESCRIPTION,TABLE_ROWS,CREATE_TIME,UPDATE_TIME
       FROM INFORMATION_SCHEMA.PARTITIONS
       WHERE PARTITION_NAME is not null and TABLE_SCHEMA = '${statApp.config.databaseRW.instanceName}';`
        const list = await Hex40Map.sequelize.query(sql,{
            type: QueryTypes.SELECT
        })
        ctx.body = {list}
    })
    router.get('/devops/prune-info', async(ctx)=>{
        const {orderBy} = ctx.request.query;
        const list = await PruneInfo.findAll({order:[[orderBy || 'pruned','desc']], limit: 100})
        ctx.body = {list}
    })
    router.get('/devops/list-tx',
        async (ctx) => {
            const {skipStr = 0, limitStr = 10} = ctx.request.query
            const skip = Number(skipStr)
            const limit = Number(limitStr)
            const page = await new FullBlockQuery({networkId:StatApp.networkId}).listTransaction({
                ...ctx.request.query,
                skip, limit})
            ctx.body = page
        }
    )
    router.get('/devops/paging-tx',
        async (ctx) => {
            let {skip} = ctx.request.query
            skip = Number(skip || 0)
            ctx.body = await pagingFullTx(skip)
            const v = await KV.getNumber(KEY_FULL_TX_COUNT)
            ctx.body.txCountMark = v
        }
    )
    router.get('/devops/paging-block',
        async (ctx) => {
            let {skip} = ctx.request.query
            skip = Number(skip || 0)
            ctx.body = await pagingFullBlock(skip, null)
            const v = await KV.getNumber(KEY_FULL_BLOCK_COUNT)
            ctx.body.blockCountMark = v
        }
    )
    router.get('/devops/view-table',
        async (ctx) => {
            const {skipStr = 0, limitStr = 10, t='full_tx'} = ctx.request.query
            const skip = pickNumber(skipStr, 0)
            const limit = pickNumber(limitStr, 10)
            let list = []
            switch(t) {
                case 'erc721': list = await Erc721Transfer.findAll({order:[['epoch','desc']], offset: skip, limit});break;
                case 'erc1155': list = await Erc1155Transfer.findAll({order:[['epoch','desc']], offset: skip, limit});break;
                case 'erc20': list = await Erc20Transfer.findAll({order:[['epoch','desc']], offset: skip, limit});break;
                case 'full_tx': list = await FullTransaction.findAll({
                    offset: skip, limit, order:[['epoch','desc']]
                });break;
                case 'daily_token':
                    list = await DailyToken.findAll({offset: skip, limit, order:[['day','desc']]})
                    break;
                case 'config':
                    list = await KV.findAll({offset: skip, limit})
                    break;
                case 'abi_info':
                    list = await AbiInfo.findAll({offset: skip, limit, order:[["createdAt",'desc']]})
                    break;
                case 'block_row_mark':
                    list = await BlockRowMark.findAll({offset: skip, limit, order:[["id",'desc']]})
                    break;
                case 'full_tx_row_mark':
                    list = await TxnRowMark.findAll({offset: skip, limit, order:[["id",'desc']]})
                    break;
            }
            ctx.body = {list}
        }
    )
    router.get('/devops/test-list-tx-with-method',
        async (ctx) => {
            const pageInfo = await pagingFullTx(0)
            const where = pageInfo.epoch === Infinity ? {} : buildTxHigherCondition(pageInfo)
            const {epoch} = ctx.request.query
            epoch && (where['epoch'] = Number(epoch))
            const txList = await FullTransaction.findAll({where, offset:pageInfo.skip, limit: 10,
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

    router.get('/devops/table-size',
        checkLocal,
        async (ctx) => {
            ctx.body = {
                code: 0,
                addressCount: await Hex40Map.count({})
            }
        }
    )
    router.post('/devops/blacklist', async function (ctx) {
        const {address, remark} = ctx.request["body"] as any;
        const result = await statApp.desensitizer.markBlacklist({address, remark});
        ctx.body = {code: 0, data: result};
    });
    router.get('/devops/echo', (ctx)=>{
        ctx.body = {
            "headers": ctx.headers,
            "ip": getClientIP(ctx),
            "time": new Date().toISOString(),
        }
    })
    router.get("/devops/countMiner", async function(ctx) {
        new BlockAndMinerSync().rollupStatPerHour(true).then()
        ctx.body = await countRecentMiner(-1)
    })
    console.log('devops router registered.')
}
