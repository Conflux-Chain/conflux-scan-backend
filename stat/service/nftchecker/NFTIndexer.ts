import {DataTypes, Model, Op, Sequelize} from "sequelize";
import {createTable} from "../DBProvider";
import {Hex40Map} from "../../model/HexMap";
import {Token} from "../../model/Token";
import {KV, KEY_FASTEST_IPFS_GATEWAY, NFT_META_POS_EPOCH} from "../../model/KV";
import {CONST} from "../common/constant";
import {initCfxSdk} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {IPFSGatewaySync} from "../IPFSGatewaySync";
import {format} from "js-conflux-sdk";
import {regExitHook} from "../tool/ProcessTool";
import {listenPort} from "../../monitor/serverApi";
import {StuckChecker} from "../../monitor/Monitor";
import {getNFTMeta, replaceMetaAttributes} from "./NFTMetaUtil";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";

const lodash = require('lodash');

// ---------------------------- db domain --------------------------------
export const T_NFT_META = "nft_metadata"

export interface INftMeta {
    contractId: number
    tokenId: string
    epochNumber: number
    status: number
    censorStatus?: number
    retry: number
    errorType: number
    error: string
    uri: string    //  url/ipfs         base64          json
    content: string // content          decoded         ''
    updatedAt?: Date
}

export class NftMeta extends Model<INftMeta> implements INftMeta {
    contractId: number
    tokenId: string
    epochNumber: number
    status: number
    censorStatus?: number
    retry: number
    errorType: number
    error: string
    uri: string    //  url/ipfs         base64          json
    content: string // content          decoded         ''
    updatedAt?: Date

    static register(seq: Sequelize) {
        NftMeta.init({
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
            epochNumber: {type: DataTypes.BIGINT, allowNull: false},
            status: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 20},
            censorStatus: {type: DataTypes.INTEGER, allowNull: false, defaultValue: CONST.CENSOR_STATUS.TO_CENSOR},
            retry: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
            errorType: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
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

const MAX_META_RETRIES = 3
const META_RETRY_BASE_DELAY_MS = 60_000
const RETRYABLE_META_ERRORS = [50600, 50601, 50602]

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
    await new IPFSGatewaySync(false).detectGateways()
}

// --------------------------- run command -------------------------------
async function run(gateway) {
    regExitHook();
    process.once('exit', stopNFTMeta)
    await setup(gateway)
    gatewaySync = new IPFSGatewaySync()
    await startNFTMeta()
}

async function setup(gateway: string = undefined, confluxConfig: any = undefined) {
    const config = confluxConfig ? {conflux: confluxConfig} : (await init())

    const cfx = await initCfxSdk(config.conflux)
    context.cfx = cfx
    console.log(`networkId ${cfx.networkId}`)

    context.cmdGateway = gateway
    console.log(`setup gateway ${gateway}`)
}

let stuckMeta: StuckChecker;
let gatewaySync: IPFSGatewaySync;
let syncTimer: any;
let syncRunning = false;
let syncInProgress = false;

export async function startNFTMeta() {
    if (syncRunning) {
        return;
    }
    syncRunning = true;
    if (!syncInProgress) {
        await syncNFTMeta()
    }
}

export function stopNFTMeta() {
    syncRunning = false;
    if (syncTimer) {
        clearTimeout(syncTimer)
        syncTimer = undefined
    }
    gatewaySync?.stop()
}

async function syncNFTMeta() {
    if (syncInProgress) {
        return;
    }
    syncInProgress = true;
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
                stuckMeta.ok();
                break
            case Code.NO_TASK:
                console.log(`no task for metadata`)
                stuckMeta.ok();
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

    syncInProgress = false;
    if (syncRunning) {
        syncTimer = setTimeout(() => {
            syncTimer = undefined
            syncNFTMeta()
        }, delay)
    }
}

// ----------------------------- sync biz --------------------------------
async function syncNFTMetaOnce() {
    const start = Date.now()
    const lastEpoch = await KV.getNumber(NFT_META_POS_EPOCH, 0)
    const retryConditions = Array.from({length: MAX_META_RETRIES}, (_, retry) => ({
        retry,
        updatedAt: {[Op.lte]: new Date(Date.now() - META_RETRY_BASE_DELAY_MS * (2 ** retry))}
    }))
    const retryTasks = await NftMeta.findAll({
        where: {
            status: MetaStatus.FAILURE,
            errorType: {[Op.in]: RETRYABLE_META_ERRORS},
            retry: {[Op.lt]: MAX_META_RETRIES},
            [Op.or]: retryConditions
        },
        order: [['updatedAt', 'asc']],
        limit: rateInfo.limit,
        raw: true
    })
    const initLimit = rateInfo.limit - retryTasks.length
    const initTasks = initLimit > 0 ? await NftMeta.findAll({
        where: {epochNumber: {[Op.gte]: lastEpoch}, status: MetaStatus.INIT},
        order: [['epochNumber', 'asc']],
        limit: initLimit,
        raw: true,
    }) : []
    const tasks = [...retryTasks, ...initTasks]
    if (!tasks.length) {
        return Code.NO_TASK
    }

    const contractMap = await getContractByIds(tasks.map(bean => Number(bean.contractId)))
    const results = await batchFetchNFTMeta(tasks, contractMap)
    const metaFtsArray = results
        .filter((nftMeta: any) => nftMeta.status === MetaStatus.SUCCESS && nftMeta.name?.trim())
        .map((nftMeta: any) => {
            const nftMetaFts = lodash.pick(nftMeta, ['contractId', 'tokenId', 'name'])
            nftMetaFts.name = nftMetaFts.name.substring(0, 256)
            return nftMetaFts
        })

    const epochNumber = initTasks.length ? initTasks[initTasks.length - 1].epochNumber : lastEpoch
    await NftMeta.sequelize.transaction(async dbTx => {
        await KV.upsert({
            key: NFT_META_POS_EPOCH,
            value: `${epochNumber}`
        }, {transaction: dbTx})
        await NftMeta.bulkCreate(results as NftMeta[], {
            updateOnDuplicate: ['epochNumber', 'status', 'retry', 'errorType', 'error', 'uri', 'content', 'updatedAt'],
            transaction: dbTx
        })
        if (metaFtsArray.length) {
            await NftMetaFts.bulkCreate(metaFtsArray as NftMetaFts[], {
                updateOnDuplicate: ['name'],
                transaction: dbTx
            })
        }
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
    const [hexArray, tokenArray, erc1155Array] = await Promise.all([
        Hex40Map.findAll({attributes: ['id', 'hex'], where: {id: {[Op.in]: contractIds}}, raw: true}),
        Token.findAll({attributes: ['hex40id', 'ipfsGateway'], where: {hex40id: {[Op.in]: contractIds}}, raw: true}),
        Erc1155Transfer.findAll({
            attributes: ['contractId'],
            where: {contractId: {[Op.in]: contractIds}},
            group: ['contractId'],
            raw: true
        })
    ])
    const hexMap = lodash.keyBy(hexArray, 'id')
    const tokenMap = lodash.keyBy(tokenArray, 'hex40id')
    const erc1155ContractIds = new Set(erc1155Array.map(item => Number(item.contractId)))
    const contractArray = contractIds.map(contractId => {
        const hex = hexMap[contractId]
        if (!hex) {
            return {contractId, error: `contract address mapping ${contractId} not found`}
        }
        const token = tokenMap[contractId]
        return {
            contractId,
            hex: '0x' + hex.hex,
            is1155: erc1155ContractIds.has(contractId),
            ipfsGateway: token?.ipfsGateway
        }
    })
    return lodash.keyBy(contractArray, 'contractId')
}

function buildFailedNFTMeta({epochNumber, contractId, tokenId, status, retry = 0}, cause) {
    const message = String(cause?.message || cause || 'failed to fetch NFT metadata')
    const errorType = cause?.code >= 50601 && cause?.code <= 50605 ? cause.code : 50600
    return {
        contractId,
        tokenId,
        epochNumber,
        status: MetaStatus.FAILURE,
        errorType,
        error: message.substr(0, 1024),
        uri: '',
        content: '',
        name: '',
        retry: status === MetaStatus.FAILURE ? Number(retry) + 1 : Number(retry)
    }
}

async function batchFetchNFTMeta(tasks, contracts) {
    return Promise.all(tasks.map(async task => {
        const {contractId, tokenId} = task
        try {
            const contract = contracts[Number(contractId)]
            if (!contract?.hex) {
                return buildFailedNFTMeta(task, contract?.error || `contract ${contractId} not found`)
            }
            const {hex, is1155, ipfsGateway} = contract
            const gateway = await getIPFSGateway(ipfsGateway)
            const {uri, content, name, errorType, error: e} = await fetchNFTMeta(hex, tokenId, is1155, gateway)
            const [status, error] = errorType ? [MetaStatus.FAILURE, e.substr(0, 1024)] : [MetaStatus.SUCCESS, e]
            return {
                contractId,
                tokenId,
                epochNumber: task.epochNumber,
                status,
                errorType,
                error,
                uri,
                content,
                name,
                retry: status === MetaStatus.FAILURE && task.status === MetaStatus.FAILURE
                    ? Number(task.retry) + 1
                    : 0
            }
        } catch (e) {
            return buildFailedNFTMeta(task, e)
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
        const {rawURI, meta} = await getNFTMeta(context.cfx, contract, tokenId, ipfsGateway, is1155 ? "uri": "tokenURI");
        replaceMetaAttributes(contract, meta);
        tokenURI = rawURI;
        json = meta;
        jsonStr = JSON.stringify(json) || ''
        name = meta['name'] || ''
    } catch (e) {
        if(context.debug) {
            console.error(`${JSON.stringify(e)}---${e}`)
            console.error(`${JSON.stringify(Object.getOwnPropertyNames(e))}---${e?.code}---${e.message}`)
        }
        // code refers to LogicError.ts
        const errorType = (e.code && e.code >= 50601 && e.code <= 50605) ? e.code : 50600;
        console.log(`fetch fail, ${logBasic} ${tokenURI}, ${e.message}`)
        return {uri: tokenURI, content: '', name: '', error: `${e.message}`, errorType}
    } finally {
        timer && clearTimeout(timer)
    }

    console.log(`ok ${logBasic} ${tokenURI}`)
    return {uri: tokenURI, content: jsonStr, name, error: ''}
}

const defaultGateway = 'https://ipfs.io'

async function getIPFSGateway(gateway) {
    if(context.cmdGateway) {
        return context.cmdGateway
    }

    const userGateway = IPFSGatewaySync.tmplFromGateway(gateway)
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
