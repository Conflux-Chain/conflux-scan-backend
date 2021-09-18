import * as Router from "koa-router";
import {StatApp} from "../StatApp";

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
}
