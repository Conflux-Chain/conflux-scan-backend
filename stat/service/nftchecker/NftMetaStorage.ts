import {DataTypes, Model, Op, QueryTypes, Sequelize} from "sequelize";
import { AbortController } from "node-abort-controller";
import {createTable} from "../DBProvider";
import {Hex40Map} from "../../model/HexMap";
import {NftMint, Token} from "../../model/Token";
import {KV, KEY_FASTEST_IPFS_GATEWAY, NFT_META_POS_EPOCH} from "../../model/KV";
import {CONST} from "../common/constant";
import {initCfxSdk} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {TokenQuery} from "../TokenQuery";
import {IPFSGatewaySync} from "../IPFSGatewaySync";
import {CENSOR_STATUS} from "../censor/CensorService";

const lodash = require('lodash');
const { NFTMetaParser } = require('@confluxfans/nft-utils');

// ---------------------------- db domain --------------------------------
// alter table nft_meta add column uri mediumtext not null after tokenId;
// update nft_meta m set m.uri=ifnull( (select u.uri from nft_uri u where u.id=m.id), '');
// alter table nft_meta drop column id;
// alter table nft_meta PARTITION BY HASH(cid) PARTITIONS 101;
// drop table nft_uri;
// select * from nft_meta m left join nft_uri u on m.id=u.id where u.id is null limit 5;
export const T_NFT_META = "nft_metadata";

export interface INftMeta {
    contractId: bigint,
    tokenId: string,
    epochNumber:number,
    status: number,
    censorStatus?: number;
    retry: number,
    errorType: number,
    error: string,
    uri: string;    //  url/ipfs         base64          json
    content: string, // content          decoded         ''
}

export class NftMeta extends Model<INftMeta> implements INftMeta {
    contractId: bigint;
    tokenId: string;
    epochNumber:number;
    status: number;
    censorStatus?: number;
    retry: number;
    errorType: number;
    error: string;
    uri: string;    //  url/ipfs         base64          json
    content: string; // content          decoded         ''

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
        });
    }
}

export interface INftMetaOld {
    cid: bigint,
    tokenId: string, // max length 78
    uri: string;    //  url/ipfs         base64          json
    content: string, // content          decoded         ''
    status: string, // ok, error
    errorType: number,
    error: string,
}

export class NftMetaOld extends Model<INftMetaOld> implements INftMetaOld {
    cid: bigint;
    tokenId: string;
    uri: string;    //  url/ipfs         base64          json
    content: string; // content          decoded         ''
    status: string; // ok, error
    errorType: number;
    error: string;
    static register(seq:Sequelize) {
        NftMetaOld.init({
            cid: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
            uri: {type: DataTypes.TEXT({length: "medium"}), allowNull: false},
            content: {type: DataTypes.TEXT({length: "medium"}), allowNull: false},
            status: {type: DataTypes.STRING(32), allowNull: false},
            errorType: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
            error: {type: DataTypes.STRING(1024), allowNull: false},
        }, {
            sequelize: seq, tableName: "nft_meta",
            indexes: [
                {name: 'idx_cid_tid', fields: ['cid', 'tokenId'], unique: true}
            ]
        });
    }
}

export async function createNftMetaPartition(seq: Sequelize) {
    const sql = `CREATE TABLE if not exists ${T_NFT_META} (
  contractId bigint(20) NOT NULL,
  tokenId varchar(78) NOT NULL,
  epochNumber bigint(20) NOT NULL,
  status int(2) NOT NULL DEFAULT '20',
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
//
// select * from nft_metadata_fts
// where match(name) against('NFT' in natural language mode)
// limit 10;
export const T_NFT_META_FTS = "nft_metadata_fts";

export interface INftMetaFts {
    contractId: bigint,
    tokenId: string,
    name: string,
}

export class NftMetaFts extends Model<INftMetaFts> implements INftMetaFts {
    contractId: bigint;
    tokenId: string;
    name: string;

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
        });
    }
}

// ---------------------------- biz domain -------------------------------
enum Code {
    NO_TASK, NEXT,
}

export enum MetaStatus {
    INIT = 20, PROCESSING = 21, SUCCESS = 22, FAILURE = 23,
}

const ERROR_CALL_NFT_CONTRACT = new Set<number>([-32015]);
const ERROR_QUERY_NFT_METADATA_REQ = new Set<string>(['ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND',
    'EHOSTUNREACH', 'EPROTO', 'EAI_AGAIN', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const ERROR_QUERY_NFT_METADATA_RESP = new Set<number>([400, 403, 404, 405, 429, 500, 502, 503]);
const ERROR_PARSE_NFT_METADATA = new Set<string>(['SyntaxError']);

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

function getMetaTypeComment(){
    return Object.keys(ErrorType).map(k => `${ErrorType[k].code}:${ErrorType[k].desc}`).join(',\n');
}

// -------------------------- test command -------------------------------
async function test(contract: string, tokenId, is1155) {
    return fetchMeta(contract, tokenId, is1155).then(res => {
        console.log(`result:`, res)
        return res;
    })
}

async function test1() {
    const rpc = 'http://main.confluxrpc.com'; //net 1029
    /*const rpc = 'http://47.242.14.46:12537'; //net 1*/
    await setup('https://crustwebsites.net', {url: rpc});

    await test("0x8376e10d14f6feeaac24fff5694524731be4df1e", "999", false)
}

// ------------------------- gateway command -----------------------------
async function getGateway() {
    await new IPFSGatewaySync({})['detectGateways']()
    console.log(`best gateway [${IPFSGatewaySync.fastest}]`)
}

// --------------------------- diff command ------------------------------
async function diff(options: { save?: boolean, debug?: boolean, updateAll?: boolean, nft?: { cid?: string, refresh?: boolean } } = {
    save: false,
    updateAll: false,
    debug: false,
    nft: { cid: '', refresh: false }
}) {
    await setup();
    const processCid = options?.nft?.cid;
    const refresh = options?.nft?.refresh;

    const nftMintGroupList = await NftMint.sequelize.query('select contractId, count(*) as cntr from nft_mint_2 group by contractId',
        {type: QueryTypes.SELECT, raw: true, logging: sql => console.log(`NftMint group sql ${sql}`)});
    const nftMetaGroupList = await NftMeta.sequelize.query('select contractId, count(*) as cntr from nft_metadata group by contractId',
        {type: QueryTypes.SELECT, raw: true, logging: sql => console.log(`NftMint group sql ${sql}`)});

    const nftMintGroupMap = lodash.keyBy(nftMintGroupList, 'contractId');
    const nftMetaGroupMap = lodash.keyBy(nftMetaGroupList, 'contractId');

    const diffMap = {};
    let skippedCntr = 0;
    for (const cid of Object.keys(nftMintGroupMap)) {
        const nftMintStat = nftMintGroupMap[cid];
        const nftMetaStat = nftMetaGroupMap[cid];
        if (!nftMetaStat || nftMintStat['cntr'] !== nftMetaStat['cntr']) {
            console.log(`diff cid ${cid} ${!nftMetaStat ? 'nftMeta is null' : ''} ${(nftMetaStat && nftMintStat['cntr'] !== nftMetaStat['cntr']) ? `nftMint ${nftMintStat['cntr']} nftMeta ${nftMetaStat['cntr']}` : ''}`)

            const nftMintCntr = nftMintStat['cntr'];
            const nftMetaCntr = (!nftMetaStat) ? 0 : nftMetaStat['cntr'];
            /*if(nftMintCntr <= 10000) {
               skippedCntr ++;
               continue;
            }*/
            diffMap[cid] = {nftMintCntr, nftMetaCntr};
        } else {
            if(refresh && cid === processCid){
                diffMap[cid] = {};
            }
        }
    }
    options.debug && console.log(`diff diffMap size ${Object.keys(diffMap).length}`);

    const totalCntr = Object.keys(diffMap).length;
    let processCntr = 0;
    for (const cid of Object.keys(diffMap)) {
        const contractMap = await getContractInfo([Number(cid)]);
        const nftArray = await NftMint.findAll({attributes: [['epoch', 'epochNumber'], 'tokenId'], where: {contractId: Number(cid)}, raw: true,
            /*logging: sql => console.log(`NftMint.findAll ${sql}`)*/});
        const metaArray = await NftMeta.findAll({attributes: ['tokenId'], where: {contractId: Number(cid)}, raw: true,
            /*logging: sql => console.log(`NftMeta.findAll ${sql}`)*/});
        const metaTokenIdSet = new Set<string>();
        metaArray.forEach(meta => metaTokenIdSet.add(meta.tokenId));
        const missingMetaArray = [];
        nftArray.forEach(nft => {
            if (!metaTokenIdSet.has(nft.tokenId)) {
                missingMetaArray.push(nft);
            }
        });
        if (options.debug && (!processCid || (processCid && cid === processCid))) {
            console.log(`cid ${cid} contractMap ${JSON.stringify(contractMap)}`)
            console.log(`cid ${cid} diff ${JSON.stringify(diffMap[cid])}`)
            /*console.log(`cid ${cid} diff missing metas ${JSON.stringify([...missingMetaArray])}`);*/
        }

        let tasks;
        if (options.updateAll) {
            await NftMeta.destroy({where: {contractId: cid}});
            tasks = nftArray.map(bean => {bean['contractId'] = Number(cid); return bean;});
        } else {
            tasks = missingMetaArray.map(bean => {bean['contractId'] = Number(cid); return bean;});
        }

        if (options.save && (!processCid || (processCid && cid === processCid))) {
            let pageSize = 10;
            let pageNo = 0;
            do {
                pageNo ++;
                const taskArray = tasks.slice((pageNo -1) * pageSize, pageNo * pageSize)
                if (taskArray?.length) {
                    const results = await batchFetchMeta(taskArray, contractMap);
                    await NftMeta.bulkCreate(results as NftMeta[], {
                        updateOnDuplicate:['epochNumber', 'status', 'retry', 'errorType', 'error', 'uri', 'content'],
                    });
                }
            } while ((pageNo * pageSize) <= tasks.length);
            options.debug && console.log(`cid ${cid} processed ${++processCntr}/${totalCntr} skippedCntr ${skippedCntr}`);
        }
    }
}

async function migrate() {
    await setup();
    const nftMetaOldList = await NftMetaOld.sequelize.query('select cid, count(*) as cntr from nft_meta group by cid',
        {type: QueryTypes.SELECT, raw: true, logging: sql => console.log(`NftMetaOld group sql ${sql}`)});
    console.log(`nftMetaOldList ${nftMetaOldList.length}`)
    let processTokens = 0;
    let skippedTokens = 0;
    for(const nftMetaOld of nftMetaOldList){
        const cid = nftMetaOld['cid'];
        const cntr = nftMetaOld['cntr'];
        if(cntr <= 10000) {
            skippedTokens ++;
            continue;
        }
        const tasks = await NftMetaOld.findAll({attributes: ['tokenId'], where: {cid: Number(cid)}, raw: true});

        let pageSize = 10;
        let pageNo = 0;
        do {
            pageNo ++;
            const taskArray = tasks.slice((pageNo -1) * pageSize, pageNo * pageSize)
            if (taskArray?.length) {
                const tokenIdArray = taskArray.map(task => task.tokenId);
                const results = await NftMetaOld.findAll({
                    attributes: [['cid', 'contractId'], 'tokenId', 'status', 'errorType', 'error', 'uri', 'content'],
                    where: {cid: Number(cid), tokenId: {[Op.in]: tokenIdArray}},
                    raw: true}
                    ) as any[];

                const nftMintArray = await NftMint.findAll({
                    attributes: ['contractId', 'tokenId', 'epoch'],
                    where: {contractId: Number(cid), tokenId: {[Op.in]: tokenIdArray}},
                    raw: true}
                ) as any[];
                const nftMintMap = lodash.keyBy(nftMintArray, 'tokenId');

                results.forEach(result => {
                    result['status'] = (result['status'] === 'ok' ? 22 : 23);
                    result['epochNumber'] = (nftMintMap[result['tokenId']])['epoch'];
                });
                console.log(`cid ${cid} tokenIdArray ${JSON.stringify(tokenIdArray)}`);

                await NftMeta.bulkCreate(results as NftMeta[], {
                    updateOnDuplicate:['epochNumber', 'status', 'retry', 'errorType', 'error', 'uri', 'content'],
                });
            }
        } while ((pageNo * pageSize) <= tasks.length);
        console.log(`processTokens ${++processTokens}/${nftMetaOldList.length} skippedTokens ${skippedTokens}`)
    }
}

async function reindex(options: { save?: boolean, debug?: boolean, updateAll?: boolean, nft?: { cid?: string, refresh?: boolean } } = {
    save: false,
    updateAll: false,
    debug: false,
    nft: { cid: '', refresh: false }
}) {
    await setup();
    const processCid = options?.nft?.cid;
    const refresh = options?.nft?.refresh;

    const nftMetaGroupList = await NftMeta.sequelize.query('select contractId, count(*) as cntr from nft_metadata group by contractId',
        {type: QueryTypes.SELECT, raw: true, logging: sql => console.log(`NftMeta group sql ${sql}`)});
    const nftMetaFtsGroupList = await NftMetaFts.sequelize.query('select contractId, count(*) as cntr from nft_metadata_fts group by contractId',
        {type: QueryTypes.SELECT, raw: true, logging: sql => console.log(`NftMetaFts group sql ${sql}`)});

    const nftMetaGroupMap = lodash.keyBy(nftMetaGroupList, 'contractId');
    const nftMetaFtsGroupMap = lodash.keyBy(nftMetaFtsGroupList, 'contractId');

    const diffMap = {};
    let skippedCntr = 0;
    for (const cid of Object.keys(nftMetaGroupMap)) {
        const nftMetaStat = nftMetaGroupMap[cid];
        const nftMetaFtsStat = nftMetaFtsGroupMap[cid];
        if (!nftMetaFtsStat || nftMetaStat['cntr'] !== nftMetaFtsStat['cntr']) {
            console.log(`diff cid ${cid} ${!nftMetaFtsStat ? 'nftMetaFts is null' : ''} ${(nftMetaFtsStat && nftMetaStat['cntr'] !== nftMetaFtsStat['cntr']) ? `nftMeta ${nftMetaStat['cntr']} nftMetaFts ${nftMetaFtsStat['cntr']}` : ''}`)

            const nftMetaCntr = nftMetaStat['cntr'];
            const nftMetaFtsCntr = (!nftMetaFtsStat) ? 0 : nftMetaFtsStat['cntr'];
           /* if(nftMetaCntr <= 10000) {
                skippedCntr ++;
                continue;
            }*/
            diffMap[cid] = {nftMetaCntr, nftMetaFtsCntr};
        } else {
            if(refresh && cid === processCid){
                diffMap[cid] = {};
            }
        }
    }
    options.debug && console.log(`diff diffMap size ${Object.keys(diffMap).length}`);

    const totalCntr = Object.keys(diffMap).length;
    let processCntr = 0;
    for (const cid of Object.keys(diffMap)) {
        const metaArray = await NftMeta.findAll({
            attributes: ['tokenId'], where: {contractId: Number(cid)}, raw: true,
            // logging: sql => console.log(`NftMeta.findAll ${sql}`)
        });
        const metaFtsArray = await NftMetaFts.findAll({
            attributes: ['tokenId'], where: {contractId: Number(cid)}, raw: true,
            // logging: sql => console.log(`NftMetaFts.findAll ${sql}`)
        });
        const metaFtsTokenIdSet = new Set<string>();
        metaFtsArray.forEach(metaFts => metaFtsTokenIdSet.add(metaFts.tokenId));
        const missingMetaFtsArray = [];
        metaArray.forEach(meta => {
            if (!metaFtsTokenIdSet.has(meta.tokenId)) {
                missingMetaFtsArray.push(meta);
            }
        });
        if (options.debug && (!processCid || (processCid && cid === processCid))) {
            console.log(`cid ${cid} diff ${JSON.stringify(diffMap[cid])}`)
            /*console.log(`cid ${cid} diff missing metaFts ${JSON.stringify([...missingMetaFtsArray])}`);*/
        }

        let tasks;
        if (options.updateAll) {
            await NftMetaFts.destroy({where: {contractId: cid}});
            tasks = metaArray;
        } else {
            tasks = missingMetaFtsArray;
        }

        if (options.save && (!processCid || (processCid && cid === processCid))) {
            let pageSize = 10;
            let pageNo = 0;
            do {
                pageNo ++;
                const taskArray = tasks.slice((pageNo -1) * pageSize, pageNo * pageSize)
                if (taskArray?.length) {
                    const tokenIdArray = taskArray.map(task => task.tokenId);
                    const metaArray = await NftMeta.findAll({
                        attributes: ['contractId', 'tokenId', 'status', 'content'],
                        where: {contractId: Number(cid), tokenId: {[Op.in]: tokenIdArray}},
                        raw: true}
                    ) as any[];
                    const metaFtsArray = metaArray.map(meta => {
                        const metaFts = lodash.pick(meta, ['contractId', 'tokenId']);
                        if(meta.status === MetaStatus.SUCCESS) {
                            const metadata = JSON.parse(meta.content);
                            metaFts.name = metadata.name || '';
                        } else {
                            metaFts.name = '';
                        }
                        return metaFts;
                    });
                    await NftMetaFts.bulkCreate(metaFtsArray as NftMetaFts[], {
                        updateOnDuplicate:['name'],
                    });
                }
            } while ((pageNo * pageSize) <= tasks.length);
            options.debug && console.log(`cid ${cid} processed ${++processCntr}/${totalCntr} skippedCntr ${skippedCntr}`);
        }
    }
}

// --------------------------- run command -------------------------------
async function run(cmd, gateway) {
    await setup(gateway)
    await syncIPFSGateway();
    await startMetaWorker(cmd);
}

async function setup(gateway: string = undefined, confluxConfig: any = undefined) {
    const config = confluxConfig ? {conflux: confluxConfig} : (await init());

    const cfx = await initCfxSdk(config.conflux)
    context.cfx = cfx;
    console.log(`networkId ${cfx.networkId}`)

    context.cmdGateway =  gateway;
    console.log(`cmdGateway ${gateway}`)
}

async function syncIPFSGateway() {
    const ipfsGatewaySync = new IPFSGatewaySync({});
    await ipfsGatewaySync.schedule();
}

export async function startMetaWorker(cmd: string) {
    if (cmd === 'metadata') {
        repeat().then();
    } else {
        console.log(`command [${cmd}] not supported, supports [metadata]`)
    }
}

async function repeat() {
    let delay = 5_000;

    try {
        let code = await syncMeta();
        switch (code) {
            case Code.NEXT:
                delay = 0;
                context.count += 1;
                break;
            case Code.NO_TASK:
                console.log(`no task for metadata`);
                break;
            default:
                console.log(`type ${code} not supported`);
        }
    } catch (e) {
        console.log(`process metadata fail:`, e);
        process.exit(9);
    }

    setTimeout(() => repeat(), delay);
}

// ----------------------------- sync biz --------------------------------
async function syncMeta() {
    const start = Date.now();
    const lastEpoch = await KV.getNumber(NFT_META_POS_EPOCH, 0);
    const tasks = await NftMeta.findAll({
        where: {epochNumber: {[Op.gte]: lastEpoch}, status: MetaStatus.INIT},
        order: [['epochNumber', 'asc']],
        limit: rateInfo.limit,
        raw: true,
        /*logging: sql => console.log(`NftMeta.findAll ${sql}`),*/
    });
    if (!tasks.length) {
        return Code.NO_TASK;
    }

    const contractMap = await getContractInfo(tasks.map(bean => Number(bean.contractId)));
    const results = await batchFetchMeta(tasks, contractMap);
    const metaFtsArray = results.map(nftMeta => {
        const nftMetaFts = lodash.pick(nftMeta, ['contractId', 'tokenId', 'name']);
        nftMetaFts.name = !nftMetaFts.name ? nftMetaFts.name : nftMetaFts.name?.substring(0, 256);
        return nftMetaFts;
    });

    const {epochNumber} = tasks[tasks.length - 1];
    await NftMeta.sequelize.transaction(async dbTx => {
        await KV.upsert({key: NFT_META_POS_EPOCH, value: `${epochNumber}`});
        await NftMeta.bulkCreate(results as NftMeta[], {
            updateOnDuplicate:['epochNumber', 'status', 'retry', 'errorType', 'error', 'uri', 'content'],
            transaction: dbTx,
        });
        await NftMetaFts.bulkCreate(metaFtsArray as NftMetaFts[], {
            updateOnDuplicate:['name'],
            transaction: dbTx,
        });
    });

    adjustBatchSize(Date.now() - start);
    if (context.count % 1000 === 0) {
        console.log(`task:${JSON.stringify(tasks)},result:${JSON.stringify(results)},rate:${JSON.stringify(rateInfo)}`);
    }
    return Code.NEXT;
}

async function getContractInfo(contractIds: number[]) {
    contractIds = [...new Set(contractIds)];
    const contractArray = await Promise.all(contractIds.map(async contractId =>{
        const hex = await Hex40Map.findByPk(contractId);
        const typeInfo = await TokenQuery.detectTokenType({hex40id: contractId});
        const token = await Token.findOne({attributes: ["ipfsGateway"], where: {hex40id: contractId}});
        return {contractId, hex: '0x' + hex.hex, is1155: typeInfo?.type === CONST.TRANSFER_TYPE.ERC1155,
            ipfsGateway: token.ipfsGateway};
    }));
    return lodash.keyBy(contractArray, 'contractId');
}

async function batchFetchMeta(taskArray, contractMap) {
    return Promise.all(taskArray.map(async ({epochNumber, contractId, tokenId}) => {
        const contractInfo = contractMap[Number(contractId)];
        const ipfsGateway = await getIpfsGateway(contractInfo.ipfsGateway);
        const {uri, content, name, errorType, error} = await fetchMeta(contractInfo.hex, tokenId, contractInfo.is1155,
            ipfsGateway);
        const [status, err] = error ? [MetaStatus.FAILURE, error.substr(0, 1024)] : [MetaStatus.SUCCESS, error];
        return {contractId, tokenId, epochNumber, status, retry: 0, errorType, error: err, uri, content, name};
    }));
}

async function fetchMeta(contract: string, tokenId: string, is1155: boolean, ipfsGateway?: string)
    : Promise<{ uri: string, content: string, name: string, error: string, errorType?: number }> {

    const basicInfo = `${contract} ${is1155 ? '1155' : '721'} tokenId ${tokenId} tokenURI`;
    let tokenURI = '';
    let json: any;
    let timer: any;
    let jsonStr;
    let name;

    let metaParser;
    try {
        metaParser = new NFTMetaParser(context.cfx, ipfsGateway);
        tokenURI = await metaParser.getTokenURI(contract, tokenId, is1155);
        const controller = new AbortController();
        timer = setTimeout(() => {
            console.log(`cancel request ${basicInfo} ${tokenURI}`);
            controller.abort();
        }, 11_000);
        json = await metaParser.getMetaByURI(tokenURI, {timeout: 10_000, signal: controller.signal});
        jsonStr = JSON.stringify(json) || '';
        name = json['name'] || '';

    } catch (e) {
        let errorType: number;
        if (e?.code && ErrorType.CALL_NFT_CONTRACT.errors.has(e.code)) {
            errorType = ErrorType.CALL_NFT_CONTRACT.code;
        }
        if (e?.code && ErrorType.QUERY_NFT_METADATA_REQ.errors.has(e.code)) {
            errorType = ErrorType.QUERY_NFT_METADATA_REQ.code;
        }
        if (e?.status && ErrorType.QUERY_NFT_METADATA_RESP.errors.has(e.status)) {
            errorType = ErrorType.QUERY_NFT_METADATA_RESP.code;
        }
        if (`${e}`.startsWith('SyntaxError')) {
            errorType = ErrorType.PARSE_NFT_METADATA.code;
        }
        if (errorType) {
            console.log(`known error, ${basicInfo} ${tokenURI}, ${errorType}-${e.message || ''}`);
            return {uri: tokenURI, content: '', name: '', error: `${e.message || ''}`, errorType}
        }

        console.log(`fetch fail, ${basicInfo} ${tokenURI}, ${e.message}`);
        context.debug && console.log(`debug error ${JSON.stringify(e)}---${e}`)
        context.debug && console.log(`debug error ${JSON.stringify(Object.getOwnPropertyNames(e))}---${e?.code}---${e.message}`)
        return {uri: tokenURI, content: '', name: '', error: `${e.message}`, errorType: ErrorType.OTHERS.code}
    } finally {
        timer && clearTimeout(timer);
        metaParser = undefined;
    }

    const isJsonBroken = tokenURI.length > 2 && jsonStr.length <= 2;
    if (isJsonBroken) {
        console.log(`known error, ${basicInfo} ${tokenURI}, ${jsonStr}`);
        return {uri: tokenURI, content: jsonStr, name: '', error: 'Not a json',
            errorType: ErrorType.PARSE_NFT_METADATA.code};
    }

    console.log(`ok ${basicInfo} ${tokenURI}`);
    return {uri: tokenURI, content: jsonStr, name, error: ''};
}

const defaultGateway = 'https://ipfs.io';
async function getIpfsGateway(userGateway) {
    if(context.cmdGateway) {
        return context.cmdGateway;
    }

    const userGatewayTmpl = userGateway && IPFSGatewaySync.tmplFromGateway(userGateway);
    if(userGatewayTmpl) {
        const pos = userGatewayTmpl.indexOf('/ipfs/:hash');
        return pos > 0 ? userGatewayTmpl.substring(0, pos) : userGatewayTmpl;
    }

    let sysGatewayImpl = await KV.getString(KEY_FASTEST_IPFS_GATEWAY, "");
    if (sysGatewayImpl) {
        const pos = sysGatewayImpl.indexOf('/ipfs/:hash');
        return pos > 0 ? sysGatewayImpl.substring(0, pos) : sysGatewayImpl;
    }

    return defaultGateway;
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
    const [, , cmd, gateway] = process.argv
    if (cmd === 'test') {
        test1().then();
    } else if (cmd === "gateway") {
        getGateway().then();
    } else if (cmd === "diff") {
        diff({save: true, debug: true, updateAll: false, /*nft: { cid: '74060613', refresh: false }*/}).then();
    } else if (cmd === "migrate") {
        migrate().then();
    } else if (cmd === "reindex") {
        reindex({save: true, debug: true, updateAll: false, /*nft: { cid: '74060613', refresh: false }*/}).then();
    } else {
        run(cmd, gateway).then();
    }
}
