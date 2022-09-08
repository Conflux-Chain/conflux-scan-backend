import {Erc1155Data, NftMint} from "../../model/Token";

import {Conflux} from "js-conflux-sdk";
const { NFTMetaParser } = require('@confluxfans/nft-utils');
import {DataTypes, fn, Model, Op, Sequelize, QueryTypes} from "sequelize";
import {KV, NFT_META_POS_1155, NFT_META_POS_721} from "../../model/KV";
import {createConflux, patchHttpProvider} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {Hex40Map} from "../../model/HexMap";

const {abi} = require('../abi/Crc1155Core');
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

async function iter1155and721() {
    await loopTable(Erc1155Data, NFT_META_POS_1155, true);
    await loopTable(NftMint, NFT_META_POS_721, false);

    setTimeout(()=>iter1155and721(), 5_000);
}
async function loopTable(model: any, position_key: string, is1155) {
    try {
        let cnt = 0
        while (Code.next === await proc1155or721(model, position_key, is1155)) {
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
async function proc1155or721(model: any, position_key: string, is1155) {
    let preId = await KV.getNumber(position_key, 0,)
    let nextId = preId + 1;
    const list = await model.findAll({where: {id: {[Op.gte]: nextId}}, order: [['id', 'asc']],
        limit: rateInfo.limit});
    if (!list.length) {
        return Code.no_task;
    }
    let start = Date.now();
    await Promise.all(list.map(({contractId, tokenId})=>fetchMeta(contractId, tokenId, is1155)));
    let elapse = Date.now() - start;
    let curRate = Math.round(1000 / (elapse / rateInfo.limit))
    if (curRate <= rateInfo.targetQps) {
        if (rateInfo.limit < rateInfo.maxLimit) {
            rateInfo.limit += 1;
            console.log(`increase batch size to ${rateInfo.limit}, current rate ${curRate}, elapse ${elapse}`)
        }
    } else if (rateInfo.limit > 0){
        rateInfo.limit -= 1;
    }
    const {id:lastBeanId} = list[list.length-1]
    await KV.saveNumber(position_key, lastBeanId, null);
    return Code.next;
}
const context:any = {
    cfx: null, metaParser: null,
}
async function run() {
    await setup()
    await iter1155and721();
}
async function setup() {
    const config = await init();
    const cfx = createConflux(config.conflux)
    await cfx.updateNetworkId();
    console.log(`net work ${cfx.networkId}`)
    initContext(cfx)
}
function initContext(cfx:Conflux, ) {
    context.cfx = cfx;

    const ipfsGateway = 'https://ipfs.io';
    const metaParser = new NFTMetaParser(cfx, ipfsGateway);
    context.metaParser = metaParser;
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
        NftContract.findByPk(contractId).then(res => {
            if (!res) {
                try {
                    return NftContract.create({cid: BigInt(contractId), status: "ok", errorTimes: BigInt(0), okTimes: BigInt(0)})
                } catch (e) {
                    return NftContract.findByPk(contractId)
                }
            }
            return res;
        })
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
    const tokenURI1 = await context.metaParser.getTokenURI(contract, tokenId, is1155);
    console.log('tokenURI is ', tokenURI1)
    let json: any;
    try {
        json = await context.metaParser.getMetaByURI(tokenURI1, {timeout: 10_000});
    } catch (e) {
        // const errorStr = `${e}`
        if (e.code === 'ECONNRESET' || e.code === 'ENOTFOUND' || e.code === 'ECONNABORTED') { //
            console.log(`getMetaByURI known error ${e.code}, ${contract} ${tokenId} type ${is1155 ? '1155':'721'}`)
            return {uri: tokenURI1, content: '', error: `${e.code} ${e.message || ''}`}
        }
        console.log(`getMetaByURI fail, ${contract} ${tokenId} type ${is1155 ? '1155':'721'}:`, e)
        return {uri: tokenURI1, content: '', error: `${e}`}
    }
    // console.log('json is ', json)
    const jsonStr = JSON.stringify(json) || '';
    return {uri: tokenURI1, content: jsonStr, error: jsonStr.length <= 2 && tokenURI1.length > 2 ? 'not a json' : ''}
    // const tokenURI = await context.metaParser.getTokenURI('', 18, true);
    // console.log('tokenURI is ', tokenURI)
}
async function test(c:string, tokenId, is1155){
    await fetchJson(c, tokenId, is1155)
}
async function test1() {
    const cfx = createConflux({url: 'http://main.confluxrpc.com', networkId: 1029})
    initContext(cfx);
    await test("cfx:acdwku5ecb2813z3tz55f1h2rc6vp9fmyp023m7rat", "18", true)
    let c = "cfx:accag8sewn7kc36mv27t8zf9yg5fyuzvc6jfmyfjrj"; // 721, tokenURI

    await test(c, "1", false)
}
if (module === require.main) {
    const [,,cmd] = process.argv
    if (cmd === 'test') {
        test1().then();
    } else {
        run().then()
    }
}