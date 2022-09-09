import {Erc1155Data, NftMint, Token} from "../../model/Token";

import {Conflux} from "js-conflux-sdk";
const { NFTMetaParser } = require('@confluxfans/nft-utils');
import {DataTypes, fn, Model, Op, Sequelize, QueryTypes} from "sequelize";
import {
    KV,
    NFT_META_POS_MINT,
    NFT_META_POS_REQUEST,
} from "../../model/KV";
import {createConflux, patchHttpProvider} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {Hex40Map} from "../../model/HexMap";
import {sleep} from "../tool/ProcessTool";

export interface INftMeta {
    id?: bigint,
    cid: bigint,
    tokenId: string, // max length 78
    content: string, // content          decoded         ''
    status: string, // ok, error
    error: string,
}
export interface INftUriOnChain {
    id?: bigint;
    uri: string;    //  url/ipfs         base64          json
    uriType: string; //
}
export interface INftContract {
    cid: bigint,
    status: string, // destroyed, unreachable, malformed uri,
    errorTimes: bigint;
    okTimes: bigint;
}
export interface INftMetaRequest {
    id?: number;
    contractId: number;
    tokenId: string;
}
export class NftMetaRequest extends Model<INftMetaRequest> implements INftMetaRequest {
    id?: number;
    contractId: number;
    tokenId: string;
    type: string; // 1155 or 721
    static register(seq:Sequelize) {
        NftMetaRequest.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true}, // ref to nft meta's id
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq, tableName: "nft_meta_request",
            indexes: [
                {name: 'uk_cid_token', fields:['cid', 'tokenId']}
            ]
        })
    }
}
export async function requestUpdateNftMeta(contractId: number, tokenId:string) {
    let minted: boolean
    minted = !!(await NftMint.findOne({where:{
            contractId, tokenId
        }}))
    if (!minted) {
        console.log(`token not found in db, skip ${contractId} ${tokenId}`)
        return;
    }
    const bean = await NftMetaRequest.findOne({where: {contractId: contractId, tokenId}})
    if (bean) {
        console.log(`requestUpdateNftMeta exists`)
        return;
    }
    await NftMetaRequest.upsert({contractId: contractId, tokenId})
}
export class NftContract extends Model<INftContract> implements INftContract {
    cid: bigint;
    status: string; // destroyed, unreachable, malformed uri,
    errorTimes: bigint;
    okTimes: bigint;
    static register(seq:Sequelize) {
        NftContract.init({
            cid: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true}, // ref to nft meta's id
            status: {type: DataTypes.STRING(16), allowNull: false},
            errorTimes: {type: DataTypes.INTEGER({unsigned: true}), allowNull: false, defaultValue: 0},
            okTimes: {type: DataTypes.INTEGER({unsigned: true}), allowNull: false, defaultValue: 0},
        }, {
            sequelize: seq, tableName: "nft_contract",
        })
    }
}
export class NftUriOnChain extends Model<INftUriOnChain> implements INftUriOnChain {
    id?: bigint;
    uri: string;    //  url/ipfs         base64          json
    uriType: string; //
    static register(seq:Sequelize) {
        NftUriOnChain.init({
            id: {type: DataTypes.BIGINT, allowNull: false, primaryKey: true}, // ref to nft meta's id
            uri: {type: DataTypes.TEXT({length: "medium"}), allowNull: false},
            uriType: {type: DataTypes.STRING(16), allowNull: false},
        }, {
            sequelize: seq, tableName: "nft_uri",
        })
    }
}
export class NftMeta extends Model<INftMeta> implements INftMeta {
    id?: bigint;
    cid: bigint;
    tokenId: string;
    content: string; // content          decoded         ''
    status: string; // ok, error
    error: string;
    static register(seq:Sequelize) {
        NftMeta.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            cid: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
            // MediumText： 最大长度 16,777,215
            content: {type: DataTypes.TEXT({length: "medium"}), allowNull: false},
            status: {type: DataTypes.STRING(32), allowNull: false},
            error: {type: DataTypes.STRING(1024), allowNull: false},
        }, {
            sequelize: seq, tableName: "nft_meta",
            indexes: [
                {name: 'idx_cid_tid', fields: ['cid', 'tokenId'], unique: true}
            ]
        });
    }
}
enum Code {
    no_task, next,
}

async function startWorker(cmd: string) {
    if (cmd === 'mint') {
        repeat(NftMint, NFT_META_POS_MINT).then();
    } else if (cmd === 'request') {
        repeat(NftMetaRequest, NFT_META_POS_REQUEST).then();
    } else {
        console.log(`unknown command [${cmd}], supports [mint,request]`)
    }
}
async function repeat(model, posKey: string) {
    await loopTable(model, posKey);
    setTimeout(()=>repeat(model, posKey), 5_000);
}
async function loopTable(model: any, position_key: string) {
    try {
        let cnt = 0
        while (Code.next === await proc1155or721(model, position_key)) {
            cnt ++
            if (cnt % 10 === 0) {
                console.log(`process ${position_key}, count ${cnt}, batchSize ${rateInfo.limit}`);
            }
        }
    } catch (e) {
        console.log(`process ${position_key} meta fail:`, e)
    }
}
// automatically adjust request rate
const rateInfo = {
    targetQps: 10,
    limit: 4,
    maxLimit: 10,
}
async function proc1155or721(model: any, position_key: string) {
    let preId = await KV.getNumber(position_key, 0,)
    let nextId = preId + 1;
    const list = await model.findAll({where: {id: {[Op.gte]: nextId}}, order: [['id', 'asc']],
        limit: rateInfo.limit});
    if (!list.length) {
        console.log(`no task for ${position_key}, cursor ${nextId}`)
        return Code.no_task;
    }
    let start = Date.now();
    await Promise.all(list.map(async ({contractId, tokenId, type = ''})=>{
        const token = await Token.findOne({attributes: ['type'],where: {hex40id: contractId}})
        if (!token || !token.type) {
            return
        }
        const is1155 = token.type?.endsWith("1155");
        return fetchMeta(contractId, tokenId, is1155)
    }));
    let elapse = Date.now() - start;
    let curRate = Math.round(1000 / (elapse / rateInfo.limit))
    if (curRate <= rateInfo.targetQps) {
        if (rateInfo.limit < rateInfo.maxLimit) {
            rateInfo.limit += 1;
            console.log(`increase batch size to ${rateInfo.limit}, current rate ${curRate}, elapse ${elapse}`)
        }
    } else if (rateInfo.limit > 1){
        rateInfo.limit -= 1;
    }
    const {id:lastBeanId} = list[list.length-1]
    await KV.saveNumber(position_key, lastBeanId, null);
    return Code.next;
}
const context:any = {
    cfx: null, metaParser: null,
}
async function run(cmd) {
    await setup()
    await startWorker(cmd);
}
async function setup() {
    const config = await init();
    const cfx = createConflux(config.conflux)
    await cfx.updateNetworkId();
    console.log(`net work ${cfx.networkId}`)
    initNftMetaWorkerContext(cfx)
}
export function initNftMetaWorkerContext(cfx:Conflux, ) {
    context.cfx = cfx;

    const ipfsGateway = 'https://ipfs.io';
    const metaParser = new NFTMetaParser(cfx, ipfsGateway);
    context.metaParser = metaParser;
}
let createContractLock = false;
async function checkNftContract(contractId: number) : Promise<NftContract>{
    let res = await NftContract.findByPk(contractId);
    if (res) {
        return res;
    }
    // wait lock
    while (createContractLock) {
        await sleep(1);
    }
    // lock
    createContractLock = true;
    // check again
    res = await NftContract.findByPk(contractId);
    if (!res) {
        // create
        res = await NftContract.create({
            cid: BigInt(contractId),
            status: "ok",
            errorTimes: BigInt(0),
            okTimes: BigInt(0)
        })
    }
    // unlock
    createContractLock = false;
    return res;
}
async function fetchMeta(contractId: number, tokenId: string, is1155) {
    let [hex, meta, nftContract] = await Promise.all([
        Hex40Map.findByPk(contractId),
        NftMeta.findOne({where: {cid: contractId, tokenId}})
            .then(res => {
                if (!res) {
                    return NftMeta.create({content: "", error: "", status: "init", cid: BigInt(contractId), tokenId})
                }
                return res;
            }),
        checkNftContract(contractId),
    ])
    const {errorTimes, okTimes} = nftContract
    if (nftContract.status !== 'ok' ||
        (okTimes < 1 && errorTimes > 10) // all N errors
    ) {
        return;
    }
    if (!hex) {
        console.log(`contract hex not found ${contractId}`)
        await NftContract.update({status: 'not found'}, {where: {cid: BigInt(contractId)}})
        return;
    }
    const {uri, content, error} = await fetchJson('0x'+hex.hex, tokenId, is1155);
    let eCnt = 0, okCnt = 1;
    if (error) {
        eCnt = 1; okCnt = 0;
    }
    await NftMeta.sequelize.transaction(async dbTx=>{
        await Promise.all([
            NftMeta.update({content, error, status: error ? 'error' : 'ok'}, {where: {id: meta.id}, transaction: dbTx}),
            NftUriOnChain.upsert({id: meta.id, uri, uriType: ""}, {transaction: dbTx}),
            NftContract.increment({"errorTimes": eCnt, "okTimes": okCnt},
                {where: {cid: contractId}, transaction: dbTx}),
        ])
    })
}
async function fetchJson(contract: string, tokenId: string, is1155: boolean) {
    let tokenURI = '';
    let json: any;
    try {
        tokenURI = await context.metaParser.getTokenURI(contract, tokenId, is1155);
        json = await context.metaParser.getMetaByURI(tokenURI, {timeout: 10_000});
    } catch (e) {
        // const errorStr = `${e}`
        if (e.code == -32015) e.code = "Transaction reverted"
        if (e.response?.status) e.code = 404
        if (e.code === 'ECONNRESET' || e.code === 'ENOTFOUND'
            || e.code === 'ECONNABORTED'
            || e.code ==  "Transaction reverted"
            || e.code == 404
        ) { //
            console.log(`known error ${e.code} ${e.message || ''}, ${contract} ${tokenId} type ${is1155 ? '1155':'721'} ${tokenURI}`)
            return {uri: tokenURI, content: '', error: `${e.code} ${e.message || ''}`}
        }
        console.log(`getMeta fail, ${contract} ${tokenId} type ${is1155 ? '1155':'721'} uri [${tokenURI}]:`, e)
        return {uri: tokenURI, content: '', error: `${e}`}
    }
    console.log(`ok , ${contract} ${is1155 ? '1155' : '721'} token ${tokenId} tokenURI is `, tokenURI)
    // console.log('json is ', json)
    const jsonStr = JSON.stringify(json) || '';
    return {uri: tokenURI, content: jsonStr, error: jsonStr.length <= 2 && tokenURI.length > 2 ? 'not a json' : ''}
    // const tokenURI = await context.metaParser.getTokenURI('', 18, true);
    // console.log('tokenURI is ', tokenURI)
}
async function test(c:string, tokenId, is1155){
    return fetchJson(c, tokenId, is1155).then(res=>{
        console.log(`result:`,res)
        return res;
    })
}
async function test1() {
    const cfx = createConflux({url: 'http://main.confluxrpc.com', networkId: 1029})
    initNftMetaWorkerContext(cfx);
    // await test("0x83c125c309a0a05bf36ef3bf886de0fa802ca2ad", "16", true)
    // await test("0x89c9ec494607ae96ae2a36c8c3d0220bc3a51819", "270", true)
    await test("0x839c09d87380a421669c6e5b26c45828e65d246c", "1", true)
    // await test("cfx:acdwku5ecb2813z3tz55f1h2rc6vp9fmyp023m7rat", "18", true)
    // let c = "cfx:accag8sewn7kc36mv27t8zf9yg5fyuzvc6jfmyfjrj"; // 721, tokenURI
    //
    // await test("cfx:accag8sewn7kc36mv27t8zf9yg5fyuzvc6jfmyfjrj", "1", false)// base64
}
if (module === require.main) {
    const [,,cmd] = process.argv
    if (cmd === 'test') {
        test1().then();
    } else {
        run(cmd).then()
    }
}