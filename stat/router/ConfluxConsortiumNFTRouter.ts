import * as Router from "koa-router";
import {StatApp} from "../StatApp";
import {clear} from "../service/nftchecker/MetaInfoCache";

export function addConfluxConsortiumNFTRouter(router: Router<any, {}>, statApp: StatApp) {
    router.get('/ConfluxConsortiumNFT', async (ctx)=>{
        const {id} = ctx.request.query
        const image = `http://scan-icons.oss-cn-hongkong.aliyuncs.com/${statApp.config.oss.prefix
        }/ConfluxConsortiumNFT/${id}.png`
        ctx.body = {
            name: '树图联盟链发布',
            image,
        }
    })
    router.get('/clear-nft-meta-cache', async (ctx)=>{
        const {base32, tokenId} = ctx.request.query
        console.log(` clear-nft-meta-cache, ${base32} [${tokenId}]`)
        let bi = tokenId ? BigInt(tokenId) : undefined

        const removed = clear(base32, bi)
        ctx.body = {
            code: 0, message: 'ok'
            ,removed
        }
    })
}
