import * as Koa from 'koa'
import {ApiServer} from '../ApiServer'
import * as Router from "koa-router";
const cors = require('@koa/cors');
export async function register(app:Koa, apiServer:ApiServer) {
    app.use(cors())
    const router = new Router({ prefix: '/api' })
    let middleware = router.routes();
    app.use(middleware)

    router.get('/', async (ctx)=>{
        ctx.body = {code: 0, message: 'Conflux Scan Open Api 0.1'}
    })
}