import * as Koa from 'koa'
import * as Router from "koa-router";
import * as bodyParser from "koa-bodyparser";
import {getConsortiumService} from "../ConsortiumBridge";
import {
    mustBeEnumParamIfPresent,
    mustBeIntParamIfPresent
} from "../service/common/utils";

const cors = require('@koa/cors');
const superagent = require('superagent');
const lodash = require('lodash');

/*
-----------curl----------
curl http://127.0.0.1:13551/rpc -X POST -H "Content-Type: application/json" --data '{"method":"cfx_epochNumber","params":["0x7805bc7"],"id":1,"jsonrpc":"2.0"}'
----------result---------
{"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":1}
{"jsonrpc":"2.0","error":{"code":-32602,"message":"Invalid params: Invalid epoch number: missing 0x prefix."},"id":1}
{"jsonrpc":"2.0","result":[{"author":"CFX:TYPE.USER:AAT3PM1TWSC7W03XVEUKUB89CB07BWG6FY90TX4NHV","baseReward":"0x610e9d1885a64000","blockHash":"0x0ef063320f1145644547102b7f39e4cad7a8e0b9f31165ed3bcb7d0503b7ad29","totalReward":"0x610e9f7cab71c640","txFee":"0x0"},{"author":"CFX:TYPE.USER:AAPKCJR28DG976FZR43C5HF1RWN5XV8T1UY4R2YYEU","baseReward":"0x611b0c53c65d0000","blockHash":"0x0dbec611be0a4c4c3b29fcafe3b68e193f9859b2b20808ba7df87a0686d3fdf3","totalReward":"0x611b0eb83a957289","txFee":"0x0"}],"id":1}
*/
async function gateway(ctx) {
    const {id, jsonrpc, method, params} = parseRequestParam(ctx);
    console.log(`[req] id`, id, `jsonrpc`, jsonrpc, `method`, method, `params`, params);

    let handler;
    switch (method) {
        case 'cfx_epochNumber':
            handler = getEpochNumber;
            break;
        case 'cfx_getEpochReceipts':
            handler = getEpochReceipts;
            break;
        case 'cfx_getBlockRewardInfo':
            handler = getBlockRewardInfo;
            break;
        case 'trace_block':
            handler = traceBlock;
            break;
        case 'trace_transaction':
            handler = traceTransaction;
            break;
        case 'cfx_clientVersion':
            handler = clientVersion;
            break;
        case 'cfx_getSponsorInfo':
            handler = getSponsorInfo;
            break;
        case 'cfx_getConfirmationRiskByHash':
            handler = getConfirmationRiskByHash;
            break;
        case 'cfx_getSupplyInfo':
            handler = getSupplyInfo;
            break;
        default:
            handler = callConsortiumNode;
    }

    let result;
    try {
        result = await handler({id, jsonrpc, method, params});
        if(handler !== callConsortiumNode) {
            result = {id, jsonrpc, result};
        }
    } catch (e) {
        result = {id, jsonrpc, error:{code: e.code, message: e.message}};
    }
    console.log(`[resp] result`, result);
    setBody(ctx, result)
}

async function getEpochNumber({params}) {
    let tag = params?.length ? params[0] : undefined;
    const epochNumber = await getConsortiumService().cfx.getEpochNumber(tag);
    return `0x${epochNumber.toString(16)}`;
}

const EPOCH_TAG = new Set(['earliest', 'latest_checkpoint', 'latest_finalized', 'latest_confirmed', 'latest_state', 'latest_mined']);

async function getEpochReceipts({params}) {
    let epochNumber = params?.length ? params[0] : undefined;

    if(!epochNumber && epochNumber !== 0) {
        throw new ConsortiumError(-32602, '`params` should have at least 1 argument(s)')
    }
    if(!EPOCH_TAG.has(epochNumber) && lodash.isNaN(Number(epochNumber))) {
        throw new ConsortiumError(-32602, 'Invalid params: Invalid epoch number: missing 0x prefix.')
    }

    epochNumber = EPOCH_TAG.has(epochNumber) ? epochNumber : Number(epochNumber);
    return getConsortiumService().cfx.getEpochReceipts(epochNumber);
}

async function getBlockRewardInfo({params}) {
    const epochNumber = params?.length ? params[0] : undefined;
    return getConsortiumService().cfx.getBlockRewardInfo(epochNumber);
}

async function traceBlock({params}) {
    const blockHash = params?.length ? params[0] : undefined;
    return getConsortiumService().cfx.traceBlock(blockHash);
}

async function traceTransaction({params}) {
    const txHash = params?.length ? params[0] : undefined;
    return getConsortiumService().cfx.traceTransaction(txHash);
}

async function clientVersion({params}) {
    return getConsortiumService().cfx.getClientVersion();
}

async function getSponsorInfo({params}) {
    const addr = params?.length ? params[0] : undefined;
    return getConsortiumService().cfx.getSponsorInfo(addr);
}

async function getConfirmationRiskByHash({params}) {
    const blockHash = params?.length ? params[0] : undefined;
    return getConsortiumService().cfx.getConfirmationRiskByHash(blockHash);
}

async function getSupplyInfo({params}) {
    return getConsortiumService().cfx.getSupplyInfo();
}

async function callConsortiumNode(data) {
    const {body, error} = await superagent
        .post(getConsortiumService().config.consortiumBridge.rpc.url)
        .set('Content-Type', 'application/json')
        .send(data)
        .timeout(getConsortiumService().config.consortiumBridge.rpc.timeout)
        .retry(getConsortiumService().config.consortiumBridge.retry);
    if(!body) {
        throw error;
    }
    return body;
}

/*
------supported RPC------
'cfx_gasPrice', 'cfx_epochNumber', 'cfx_getBalance', 'cfx_getAdmin', 'cfx_getCode', 'cfx_getStorageAt',
'cfx_getBlockByHash', 'cfx_getBlockByHashWithPivotAssumption', 'cfx_getBlockByEpochNumber', 'cfx_getBestBlockHash',
'cfx_getNextNonce', 'cfx_sendRawTransaction', 'cfx_call', 'cfx_getLogs', 'cfx_getTransactionByHash',
'cfx_estimateGas', 'cfx_getBlocksByEpoch', 'cfx_getTransactionReceipt', 'cfx_getAccount',
'cfx_getMembershipChangeRawTransaction', 'cfx_sendNewConsortiumMembershipTrans',
'cfx_constructAndSendNewConsortiumMembershipTrans', 'cfx_getBFTMembershipId', 'cfx_getValidatorSet',
'cfx_updateConsortiumAndGrpcCredential', 'cfx_getConsortiumCertificate', 'cfx_getStatus'
*/
function parseRequestParam(ctx) {
    const requestData = Object.keys(ctx.request.query).length ? ctx.request.query : ctx.request.body;
    // mustBeIntParamIfPresent(requestData, 'id');
    mustBeEnumParamIfPresent(requestData, 'jsonrpc', ['2.0']);

    const {id, jsonrpc, method, params} = requestData
    return {id, jsonrpc, method, params};
}

function setBody(ctx, data: any) {
    ctx.body = data;
}

// -----------------------------------router---------------------------------------
export function addRoute(router: Router) {
    router.post('/', gateway)
}

export function registerConsortiumRouter(app: Koa) {
    const router = new Router({ prefix: '/rpcv2' })
    router.use(async (ctx, next)=>{
        try {
            await next();
        } catch (e) {
           console.log(`consortium rpc error`, e);
        }
    })
    addRoute(router);

    app.use(async (ctx, next) => {
        const start = Date.now();
        await next();
        const ms = Date.now() - start;
        ctx.set('X-Response-Time', `${ms}ms`);
    });
    app.use(cors())
    app.use(bodyParser())
    const middleware = router.routes();
    app.use(middleware)
    console.log('router registered.')
}
