import {DataTypes, Model, Op, Sequelize} from "sequelize";
import {AbortController} from "node-abort-controller";
import {createTable} from "../DBProvider";
import {Hex40Map} from "../../model/HexMap";
import {Token} from "../../model/Token";
import {KV, KEY_FASTEST_IPFS_GATEWAY, NFT_META_POS_EPOCH} from "../../model/KV";
import {CONST} from "../common/constant";
import {initCfxSdk} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {TokenQuery} from "../TokenQuery";
import {IPFSGatewaySync} from "../IPFSGatewaySync";
import {CENSOR_STATUS} from "../censor/CensorService";
import {format} from "js-conflux-sdk";
import {regExitHook} from "../tool/ProcessTool";
import {listenPort} from "../../monitor/serverApi";
import {StuckChecker} from "../../monitor/Monitor";

const lodash = require('lodash');
const {NFTMetaParser} = require('@confluxfans/nft-utils');

// ---------------------------- db domain --------------------------------
export const T_NFT_META = "nft_metadata"

export interface INftMeta {
    contractId: bigint
    tokenId: string
    epochNumber: number
    status: number
    censorStatus?: number
    retry: number
    errorType: number
    error: string
    uri: string    //  url/ipfs         base64          json
    content: string // content          decoded         ''
}

export class NftMeta extends Model<INftMeta> implements INftMeta {
    contractId: bigint
    tokenId: string
    epochNumber: number
    status: number
    censorStatus?: number
    retry: number
    errorType: number
    error: string
    uri: string    //  url/ipfs         base64          json
    content: string // content          decoded         ''

    static register(seq: Sequelize) {
        NftMeta.init({
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
            epochNumber: {type: DataTypes.BIGINT, allowNull: false},
            status: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 20},
            censorStatus: {type: DataTypes.INTEGER, allowNull: false, defaultValue: CENSOR_STATUS.TO_CENSOR},
            retry: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
            errorType: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, comment: getMetaTypeComment()},
            error: {type: DataTypes.STRING(1024), allowNull: true},
            uri: {type: DataTypes.TEXT({length: "medium"}), allowNull: true},
            content: {type: DataTypes.TEXT({length: "medium"}), allowNull: true},
        }, {
            sequelize: seq, tableName: T_NFT_META,
            indexes: [
                {name: 'idx_contractId_tokenId', fields: ['contractId', 'tokenId'], unique: true}
            ]
        })
    }
}

export async function createNftMetaPartition(seq: Sequelize) {
    const sql = `CREATE TABLE if not exists ${T_NFT_META} (
    contractId bigint(20) NOT NULL,
    tokenId varchar(78) NOT NULL,
    epochNumber bigint(20) NOT NULL,
    status int(2) NOT NULL DEFAULT '20',
    censorStatus int(2) NOT NULL DEFAULT '0',
    retry int(2) NOT NULL DEFAULT '0',
    errorType int(4) NOT NULL DEFAULT '0',
    error varchar(1024) DEFAULT NULL,
    uri mediumtext DEFAULT NULL,
    content mediumtext DEFAULT NULL,
    createdAt datetime NOT NULL,
    updatedAt datetime NOT NULL,
    UNIQUE KEY idx_contractId_tokenId (contractId,tokenId),
    KEY idx_updatedAt (updatedAt),
    KEY idx_epochNumber (epochNumber)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
/*!50100 PARTITION BY HASH (contractId)
PARTITIONS 101 */`
    return createTable(seq, sql)
        .then(() => {
            return NftMeta.register(seq)
        }).then(() => {
            NftMeta.removeAttribute("id")
        }).catch(err => {
            console.log(`create NftMeta fail, sql ${sql}:`, err)
            process.exit(9)
        })
}

// CREATE TABLE `nft_metadata_fts` (
//     `contractId` bigint(20) NOT NULL,
//     `tokenId` varchar(78) NOT NULL,
//     `name` varchar(256) NOT NULL,
//     `createdAt` datetime NOT NULL,
//     `updatedAt` datetime NOT NULL,
//     PRIMARY KEY (`contractId`,`tokenId`),
//     FULLTEXT KEY `ft_idx_name` (`name`) WITH PARSER NGRAM
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
// Usage:
// select * from nft_metadata_fts
// where match(name) against('NFT' in natural language mode)
// limit 10;
export const T_NFT_META_FTS = "nft_metadata_fts"

export interface INftMetaFts {
    contractId: bigint
    tokenId: string
    name: string
}

export class NftMetaFts extends Model<INftMetaFts> implements INftMetaFts {
    contractId: bigint
    tokenId: string
    name: string

    static register(seq: Sequelize) {
        NftMetaFts.init({
            contractId: {type: DataTypes.BIGINT, primaryKey: true, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), primaryKey: true, allowNull: false},
            name: {type: DataTypes.STRING(256), allowNull: false},
        }, {
            sequelize: seq,
            tableName: T_NFT_META_FTS,
            indexes: [
                {name: 'ft_idx_name', fields: ['name'], type: 'FULLTEXT', parser: 'NGRAM'}
            ]
        })
    }
}

// ---------------------------- biz domain -------------------------------
enum Code {
    NO_TASK, NEXT,
}

export enum MetaStatus {
    INIT = 20, PROCESSING = 21, SUCCESS = 22, FAILURE = 23,
}

const ERROR_CALL_NFT_CONTRACT = new Set<number>([-32015])
const ERROR_QUERY_NFT_METADATA_REQ = new Set<string>(['ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND',
    'EHOSTUNREACH', 'EPROTO', 'EAI_AGAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'])
const ERROR_QUERY_NFT_METADATA_RESP = new Set<number>([400, 403, 404, 405, 429, 500, 502, 503])
const ERROR_PARSE_NFT_METADATA = new Set<string>(['SyntaxError'])

const ErrorType = {
    CALL_NFT_CONTRACT: {code: 101, desc: 'call nft contract error', errors: ERROR_CALL_NFT_CONTRACT},
    QUERY_NFT_METADATA_REQ: {code: 102, desc: 'query nft metadata req error', errors: ERROR_QUERY_NFT_METADATA_REQ},
    QUERY_NFT_METADATA_RESP: {code: 103, desc: 'query nft metadata resp error', errors: ERROR_QUERY_NFT_METADATA_RESP},
    PARSE_NFT_METADATA: {code: 104, desc: 'parse nft metadata error', errors: ERROR_PARSE_NFT_METADATA},
    OTHERS: {code: 105, desc: 'other error'},
}

const context: any = {
    cfx: null,
    gateway: "",
    count: 0,
    debug: false,
}

// automatically adjust request rate
const rateInfo = {
    targetQps: 10,
    limit: 4,
    maxLimit: 10,
}

function getMetaTypeComment() {
    return Object.keys(ErrorType).map(k => `${ErrorType[k].code}:${ErrorType[k].desc}`).join(',\n')
}

// ----------------------- fetch once command ----------------------------
async function fetchOnce(gateway, rpc, contract, tokenID) {
    await setup(gateway, {url: rpc})

    const base32 = format.address(contract, context.cfx.networkId)
    const token = await Token.findOne({where: {base32}})
    if (!token) {
        throw new Error(`token ${contract} not found`)
    }

    return fetchNFTMeta(contract, tokenID, token.type === 'ERC1155').then(res => {
        console.log(`mata data==\n${JSON.stringify(res)}`, res)
        return res
    })
}

// ------------------------- gateway command -----------------------------
async function bestGateway() {
    await new IPFSGatewaySync()['detectGateways']()
    console.log(`best gateway ${IPFSGatewaySync.fastest}`)
}

// --------------------------- run command -------------------------------
async function run(gateway) {
    regExitHook();
    await setup(gateway)
    await syncIPFSGateway()
    await syncNFTMeta()
}

async function setup(gateway: string = undefined, confluxConfig: any = undefined) {
    const config = confluxConfig ? {conflux: confluxConfig} : (await init())

    const cfx = await initCfxSdk(config.conflux)
    context.cfx = cfx
    console.log(`networkId ${cfx.networkId}`)

    context.cmdGateway = gateway
    console.log(`setup gateway ${gateway}`)
}

async function syncIPFSGateway() {
    const ipfsGatewaySync = new IPFSGatewaySync()
    await ipfsGatewaySync.schedule()
}
let stuckMeta: StuckChecker;
async function syncNFTMeta() {
    if (!stuckMeta) {
        stuckMeta = new StuckChecker(`sync-nft-meta`, 10);
    }
    let delay = 5_000

    try {
        const code = await syncNFTMetaOnce()
        switch (code) {
            case Code.NEXT:
                delay = 0
                context.count += 1
                break
            case Code.NO_TASK:
                console.log(`no task for metadata`)
                break
            default:
                const message = `type ${code} not supported`;
                console.log(message)
                stuckMeta.push(message);
        }
    } catch (e) {
        console.log(`process metadata fail:`, e);
        stuckMeta.push(`failed to sync nft meta : ${e.message}`);
    }

    setTimeout(() => syncNFTMeta(), delay)
}

// ----------------------------- sync biz --------------------------------
async function syncNFTMetaOnce() {
    const start = Date.now()
    const lastEpoch = await KV.getNumber(NFT_META_POS_EPOCH, 0)
    const tasks = await NftMeta.findAll({
        where: {epochNumber: {[Op.gte]: lastEpoch}, status: MetaStatus.INIT},
        order: [['epochNumber', 'asc']],
        limit: rateInfo.limit,
        raw: true,
        /*logging: sql => console.log(`NftMeta.findAll ${sql}`),*/
    })
    if (!tasks.length) {
        return Code.NO_TASK
    }

    const contractMap = await getContractByIds(tasks.map(bean => Number(bean.contractId)))
    const results = await batchFetchNFTMeta(tasks, contractMap)
    const metaFtsArray = results.map(nftMeta => {
        const nftMetaFts = lodash.pick(nftMeta, ['contractId', 'tokenId', 'name'])
        nftMetaFts.name = !nftMetaFts.name ? nftMetaFts.name : nftMetaFts.name?.substring(0, 256)
        return nftMetaFts
    })

    const {epochNumber} = tasks[tasks.length - 1]
    await NftMeta.sequelize.transaction(async dbTx => {
        await KV.upsert({
            key: NFT_META_POS_EPOCH,
            value: `${epochNumber}`
        })
        await NftMeta.bulkCreate(results as NftMeta[], {
            updateOnDuplicate: ['epochNumber', 'status', 'retry', 'errorType', 'error', 'uri', 'content'],
            transaction: dbTx
        })
        await NftMetaFts.bulkCreate(metaFtsArray as NftMetaFts[], {
            updateOnDuplicate: ['name'],
            transaction: dbTx
        })
    })

    adjustBatchSize(Date.now() - start)
    if (context.count % 1000 === 0) {
        console.log(`
        task==\n${JSON.stringify(tasks)}
        result==\n${JSON.stringify(results)}
        rate==\n${JSON.stringify(rateInfo)}
        `)
    }
    return Code.NEXT
}

async function getContractByIds(contractIds: number[]) {
    contractIds = [...new Set(contractIds)]
    const contractArray = await Promise.all(contractIds.map(async contractId =>{
        const hex = await Hex40Map.findByPk(contractId)
        const typeInfo = await TokenQuery.detectTokenType({hex40id: contractId})
        const token = await Token.findOne({attributes: ["ipfsGateway"], where: {hex40id: contractId}})
        return {
            contractId,
            hex: '0x' + hex.hex,
            is1155: typeInfo?.type === CONST.TRANSFER_TYPE.ERC1155,
            ipfsGateway: token?.ipfsGateway
        }
    }))
    return lodash.keyBy(contractArray, 'contractId')
}

async function batchFetchNFTMeta(tasks, contracts) {
    return Promise.all(tasks.map(async ({epochNumber, contractId, tokenId}) => {
        const {hex, is1155, ipfsGateway} = contracts[Number(contractId)]
        const gateway = await getIPFSGateway(ipfsGateway)
        const {uri, content, name, errorType, error: e} = await fetchNFTMeta(hex, tokenId, is1155, gateway)
        const [status, error] = errorType ? [MetaStatus.FAILURE, e.substr(0, 1024)] : [MetaStatus.SUCCESS, e]
        return {
            contractId,
            tokenId,
            epochNumber,
            status,
            errorType,
            error,
            uri,
            content,
            name,
            retry: 0
        }
    }))
}

async function fetchNFTMeta(contract: string, tokenId: string, is1155: boolean, ipfsGateway?: string)
    : Promise<{ uri: string, content: string, name: string, error: string, errorType?: number }> {
    let tokenURI = ''
    let timer: any
    let json: any
    let jsonStr
    let name

    const logBasic = `${contract} ${is1155 ? '1155' : '721'} tokenId ${tokenId} tokenURI`
    try {
        const metaParser = new NFTMetaParser(context.cfx, ipfsGateway)
        tokenURI = await metaParser.getTokenURI(contract, tokenId, is1155)
        const controller = new AbortController()
        timer = setTimeout(() => {
            console.log(`cancel request ${logBasic} ${tokenURI}`)
            controller.abort()
        }, 11_000)
        json = await metaParser.getMetaByURI(tokenURI, {timeout: 10_000, signal: controller.signal})
        jsonStr = JSON.stringify(json) || ''
        name = json['name'] || ''
    } catch (e) {
        let errorType: number
        if (e?.code && ErrorType.CALL_NFT_CONTRACT.errors.has(e.code)) {
            errorType = ErrorType.CALL_NFT_CONTRACT.code
        }
        if (e?.code && ErrorType.QUERY_NFT_METADATA_REQ.errors.has(e.code)) {
            errorType = ErrorType.QUERY_NFT_METADATA_REQ.code
        }
        if (e?.status && ErrorType.QUERY_NFT_METADATA_RESP.errors.has(e.status)) {
            errorType = ErrorType.QUERY_NFT_METADATA_RESP.code
        }
        if (`${e}`.startsWith('SyntaxError')) {
            errorType = ErrorType.PARSE_NFT_METADATA.code
        }
        if (errorType) {
            console.log(`known error, ${logBasic} ${tokenURI}, ${errorType}---${e.message || ''}`)
            return {uri: tokenURI, content: '', name: '', error: `${e.message || ''}`, errorType}
        }

        console.log(`fetch fail, ${logBasic} ${tokenURI}, ${e.message}`)
        context.debug && console.log(`debug error ${JSON.stringify(e)}---${e}`)
        context.debug && console.log(`debug error ${JSON.stringify(Object.getOwnPropertyNames(e))}---${e?.code}---${e.message}`)
        return {uri: tokenURI, content: '', name: '', error: `${e.message}`, errorType: ErrorType.OTHERS.code}
    } finally {
        timer && clearTimeout(timer)
    }

    const isJsonBroken = tokenURI.length > 2 && jsonStr.length <= 2
    if (isJsonBroken) {
        console.log(`known error, ${logBasic} ${tokenURI}, ${jsonStr}`)
        return {uri: tokenURI, content: jsonStr, name: '', error: 'Not a json', errorType: ErrorType.PARSE_NFT_METADATA.code}
    }

    console.log(`ok ${logBasic} ${tokenURI}`)
    return {uri: tokenURI, content: jsonStr, name, error: ''}
}

const defaultGateway = 'https://ipfs.io'

async function getIPFSGateway(gateway) {
    if(context.cmdGateway) {
        return context.cmdGateway
    }

    const userGateway = gateway && IPFSGatewaySync.tmplFromGateway(gateway)
    if(userGateway) {
        return userGateway
    }

    const sysGateway = await KV.getString(KEY_FASTEST_IPFS_GATEWAY, "")
    if (sysGateway) {
        return sysGateway
    }

    return defaultGateway
}

function adjustBatchSize(elapse){
    let curRate = Math.round(1000 / (elapse / rateInfo.limit));
    if (curRate <= rateInfo.targetQps) {
        if (rateInfo.limit < rateInfo.maxLimit) {
            rateInfo.limit += 1;
        }
    } else if (rateInfo.limit > 1) {
        rateInfo.limit -= 1;
    }
}

// ----------------------------- start biz -------------------------------
if (module === require.main) {
    const [, , cmd, gateway, rpc, contract, tokenID] = process.argv
    if (cmd === 'once') {
        fetchOnce(gateway, rpc, contract, tokenID).then();
    } else if (cmd === "gateway") {
        bestGateway().then();
    } else if (cmd === "metadata") {
        run(gateway).then(()=>{
            return listenPort('nft_meta')
        });
    }else {
        throw new Error(`cmd ${cmd} not supported`)
    }
}
