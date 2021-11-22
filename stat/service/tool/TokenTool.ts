import {Conflux} from "js-conflux-sdk";
import {Token} from "../../model/Token";
import {init} from "./FixDailyTokenStat";
import {patchHttpProvider} from "../common/utils";
import {HASH_CUSTODIAN_TOKEN, RedisWrap} from "../RedisWrap";
import {decodeUtf8} from "./StringTool";
import oss = require('ali-oss');
const abi = require('./abi');
const fs = require('fs');
const path = require('path');
const lodash = require('lodash');
const Web3 = require("web3");

const NodeCache = require( "node-cache" );
const dbCache = new NodeCache()
const cacheTtl = 60 * 50 // 50 minutes
export function addTokenCache(obj:{name?, symbol, decimals?, granularity?, base32:string}) {
    dbCache.set(obj.base32 || '', obj, cacheTtl)
}
export class TokenTool {
    protected cfx;
    protected web3;
    contract;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.contract = cfx.Contract({abi});
        this.web3 = new Web3();
    }

    async getToken(address, epochNumber = undefined): Promise<any> {
        const cache = dbCache.get(address)
        if (cache) {
            dbCache.set(address, cache, cacheTtl)
            return cache
        }
        return this.awaitObject({
            address,
            name: this.contract.name()
                .call({to: address}, epochNumber)
                .catch(() => undefined),
            symbol: this.contract.symbol()
                .call({to: address}, epochNumber)
                .catch(() => undefined),
            decimals: this.contract.decimals()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch(() => undefined),
            granularity: this.contract.granularity()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch(() => undefined),
        }).then(obj=>{
            dbCache.set(address, obj, cacheTtl)
            return obj;
        });
    }

    async getTokenTotalSupply(address, epochNumber = undefined) {
        return this.contract.totalSupply()
            .call({to: address}, epochNumber)
            .then(BigInt)
            .catch(() => undefined);
    }

    async awaitObject(object): Promise<any> {
        const result = {};
        await Promise.all(lodash.map(object, async (promise, key) => {
            result[key] = await promise;
        }));
        return result;
    }

    decodeAnnounce(eventLog) {
        try {
            const tuple = this.contract.Announce.decodeLog(eventLog);
            return { ...eventLog, ...tuple.toObject() };
        } catch (e) {
            // pass
        }
        return undefined;
    }

    decodeAnnouncePlus(eventLog) {
        const { topics = [], data = '0x' } = eventLog;

        if (topics[0] === this.contract.Announce.signature && topics.length === 3 && data.length > 2) {
            const parameters = this.web3.eth.abi.decodeParameters(['bytes','bytes'], data);
            return {
                ...eventLog,
                announcer: `0x${topics[1].slice(-40)}`,
                keyHash: topics[2],
                key: Buffer.from(parameters['0'].substr(2), 'hex'),
                value: parameters['1'] ? Buffer.from(parameters['1'].substr(2), 'hex') : '',
            };
        }

        return undefined;
    }

    decodeERC20Transfer(eventLog = {}) {
        try {
            const tuple = this.contract.Transfer.decodeLog(eventLog);
            return { ...eventLog, ...tuple.toObject() };
        } catch (e) {
            // pass
        }

        return undefined;
    }

    decodeERC20TransferPlus(eventLog = {}) {
        // @ts-ignore
        const { topics = [], data = '0x' } = eventLog;

        if (topics[0] === this.contract.Transfer.signature && topics.length === 3 && data.length === 66) {
            return {
                ...eventLog,
                from: `0x${topics[1].slice(-40)}`,
                to: `0x${topics[2].slice(-40)}`,
                value: BigInt(data),
            };
        }

        return undefined;
    }

    decodeERC721Transfer(eventLog = {}) {
        // @ts-ignore
        const { topics = [], data = '0x' } = eventLog;

        // ERC721: Transfer(address indexed from, address indexed to, uint256 indexed value)
        if (topics[0] === this.contract.Transfer.signature && topics.length === 4 && data.length === 2) {
            return {
                ...eventLog,
                from: `0x${topics[1].slice(-40)}`,
                to: `0x${topics[2].slice(-40)}`,
                tokenId: BigInt(topics[3]),
            };
        }

        return undefined;
    }

    decodeERC777Transfer(eventLog = {}) {
        try {
            const tuple = this.contract.Sent.decodeLog(eventLog);
            return { ...eventLog, ...tuple.toObject() };
        } catch (e) {
            // pass
        }

        return undefined;
    }

    decodeERC1155TransferArray(eventLog = {}) {
        try {
            const tuple = this.contract.TransferBatch.decodeLog(eventLog);
            return lodash.zip(tuple.tokenIdArray, tuple.valueArray)
                .map(([tokenId, value], batchIndex) => ({ ...eventLog, ...tuple.toObject(), tokenId, value, batchIndex }))
                .filter((each) => each.tokenId !== undefined && each.value !== undefined);
        } catch (e) {
            // pass
        }

        try {
            const tuple = this.contract.TransferSingle.decodeLog(eventLog);
            return [{ ...eventLog, ...tuple.toObject(), batchIndex: 0 }];
        } catch (e) {
            // pass
        }

        return [];
    }

    decodeERC1155TransferArrayPlus(eventLog = {}) {
        // @ts-ignore
        const { topics = [], data = '0x' } = eventLog;

        if (topics[0] === this.contract.TransferSingle.signature && topics.length === 4 && data.length === 130) {
            const parameters = this.web3.eth.abi.decodeParameters(['uint256','uint256'], data);
            return [{
                ...eventLog,
                operator: `0x${topics[1].slice(-40)}`,
                from: `0x${topics[2].slice(-40)}`,
                to: `0x${topics[3].slice(-40)}`,
                tokenId: BigInt(parameters['0']),
                value: BigInt(parameters['1']),
                batchIndex: 0
            }];
        }

        if (topics[0] === this.contract.TransferBatch.signature && topics.length === 4 && data.length > 2) {
            const operator = `0x${topics[1].slice(-40)}`;
            const from = `0x${topics[2].slice(-40)}`;
            const to = `0x${topics[3].slice(-40)}`;
            const parameters = this.web3.eth.abi.decodeParameters(['uint256[]','uint256[]'], data);
            const tokenIdArray = parameters['0'];
            const valueArray = parameters['1'];
            return lodash.zip(tokenIdArray, valueArray)
                .map(([tokenId, value], batchIndex) => {
                    return {
                        ...eventLog,
                        operator,
                        from,
                        to,
                        tokenIdArray,
                        valueArray,
                        tokenId: BigInt(tokenId),
                        value: BigInt(value),
                        batchIndex
                    };
                });
        }

        return [];
    }

    async supportsInterface(address, interfaceId, epochNumber = undefined) {
        return this.contract.supportsInterface(interfaceId)
            .call({to: address}, epochNumber)
            .catch(() => undefined);
    }

    async isCustodianToken(address, custodianAddress, epochNumber) {
        const cache = await RedisWrap.hGet(HASH_CUSTODIAN_TOKEN, address, '').then(Boolean);
        if (cache !== null && cache !== undefined) {
            return cache;
        }

        return this.contract.isToken(address)
            .call({ to: custodianAddress }, epochNumber)
            .catch(() => undefined);
    }
}
export async function isCustodianToken(base32:string) {
    return RedisWrap.hGet(HASH_CUSTODIAN_TOKEN, base32, '').then(Boolean)
}
// 0x890e3feac4a2c33d7594bc5be62e7970ef5481e0
export const CUSTODIAN_PROXY_CONTRACT = 'cfx:aceu6t9m2wvpgtnzww8f13vstf2s8zeb6a4eja1756'
async function updateCustodianTokenFlag() {
    const tool = await initTool()
    async function repeat() {
        const list = await Token.findAll({where: {auditResult: true,}});
        let trueCount = 0
        let testOne = ''
        for (const token of list) {
            const is = await tool.contract.isToken(token.base32)
                .call({to: CUSTODIAN_PROXY_CONTRACT}).catch(err => {
                    console.log(`call proxy contract fail, token ${token.base32}`, err)
                    return false
                })
            trueCount += is ? 1 : 0
            if (is) {
                testOne = token.base32
            }
            await RedisWrap.hSet(HASH_CUSTODIAN_TOKEN, token.base32, is ? '1' : '');
        }
        setTimeout(repeat, 10_000)
        console.log(`set to true count ${trueCount}, test get ${testOne}, ${await isCustodianToken(testOne)}`)
        console.log(`get all `,await RedisWrap.hGetAll(HASH_CUSTODIAN_TOKEN))
    }
    repeat().then()
}


export async function base64ToPNG(token:Token, dir: string) {
    if (!token.icon) {
        console.log(`icon is not present. ${token.symbol} ${token.name} ${token.base32}`)
        return
    }
    let raw_data = decodeUtf8(token.icon);
    // console.log(`data [${raw_data.substr(0,64)}]`)
    const data = raw_data.replace(/^data:image.*base64,/, '');
    let imageType = '.png'
    if (raw_data.includes('image/svg')) {
        imageType = '.svg'
    } else if (raw_data.includes('image/vnd.microsoft.icon')) {
        imageType = '.icon'
    } else if (raw_data.includes('image/png')) {
    } else if (raw_data.includes('image/jpg')) {
        imageType = '.jpg'
    } else if (raw_data.includes('image/jpeg')) {
        imageType = '.jpeg'
    } else {
        console.log(`unknown type ${raw_data.substr(0, 64)}`)
        return
    }
    const filename = `${token.base32}${imageType}`;
    const absPath = path.resolve(dir, filename);
    fs.writeFileSync(absPath, data, 'base64');
    return {absPath, filename}
}

export function getImageDir() {
    const public_dir = __dirname + '/../../../../public/stat/';
    const dir = path.resolve(public_dir);
    return {public_dir, dir};
}

export async function saveOssUrl(token:Token, uploadResult) {
    if (!uploadResult) {
        return ;
    }
    const ossUrl = uploadResult.url;
    console.log(`upload result:`, ossUrl)
    return Token.update({iconUrl: `${ossUrl}`}, {
        where: {id: token.id}
    }).then(([cnt])=>{
        console.log(`set icon url for ${token.symbol}, affect ${cnt}`)
    })
}
async function buildImages() {
    const config = await init()
    await initOss(config.oss)
    const {public_dir, dir} = getImageDir();
    console.log(`will save at ${public_dir}\n${dir}`)
    const list = await Token.findAll({where: {auditResult: true,}})
    for (let i = 0; i < list.length; i++){
        let token = list[i];
        const {absPath, filename} = await base64ToPNG(token, dir) || {}
        const uploadResult = await uploadOss(absPath, filename)
        await saveOssUrl(token, uploadResult)
    }
    console.log(`done.`)
}
async function initTool() {
    const cfg = await init()
    const cfx = new Conflux(cfg.conflux)
    console.log(`conflux: `, cfg.conflux)
    patchHttpProvider(cfx, cfg.conflux)
    await RedisWrap.connect(cfg.redis)
    const tool = new TokenTool(cfx)
    return tool;
}

async function updateTotalSupply() {
    const tool = await initTool();

    async function repeat() {
        const list = await Token.findAll({where: {auditResult: true,
                // symbol:'PHM-NFT'
        }})
        for (const token of list) {
            const sup = await tool.contract.totalSupply()
                .call({to: token.base32}, undefined)
                .then(BigInt)
                .catch((err) => {
                    if (!err.message.includes('Transaction')) {
                        console.log(`totalSupply error:`, err)
                    }
                    return undefined
                })
            if (sup === undefined || sup === null) {
                continue
            }
            if (sup === BigInt(token.totalSupply)) {
                continue
            }
            const [cnt] = await Token.update({totalSupply: sup},
                {where: {id: token.id}});
            console.log(`update from ${token.totalSupply} to ${sup}, affect ${cnt} ${token.base32}`)
        }
        setTimeout(repeat, 10_000)
        console.log(`${new Date().toISOString()} updated ${list.length}`)
    }
    repeat().then()
}

function createOssClient(accessId, accessKey, bucket) {
    const client = new oss({
        accessKeyId: accessId,
        accessKeySecret: accessKey,
        bucket,
        secure: true,
        // oss-cn-hongkong-internal.aliyuncs.com
        // host: 'oss-cn-hongkong.aliyuncs.com',
        region: 'oss-cn-hongkong',
    });
    // client._timeout = 5000
    return client;
}

async function checkOssBucket(accessId, accessKey, bucket) {
    const client = createOssClient(accessId, accessKey, bucket);
    const result = await client.getBucketInfo(bucket).catch(err=>{
        throw err
    })
    console.log(`get oss bucket info result :`, result.bucket.ExtranetEndpoint, result.bucket.Location)
}
let ossConf = {accessId:'', accessKey:'', bucket:'', prefix: ''}
export async function initOss(conf) {
    ossConf = conf
    const {accessId, accessKey, bucket} = ossConf
    if (!accessId) {
        console.log(`oss not configured.`)
        return
    }
    console.log(`init oss, bucket ${bucket}`)
    return checkOssBucket(accessId, accessKey, bucket).then(res=>{
    }).catch(err=>{
        console.log(`check oss bucket fail: `, err)
        process.exit(1)
    });
}
export async function uploadOss(srcFile, ossFilename) {
    if (!srcFile || !ossFilename) {
        return undefined
    }
    const {accessId, accessKey, bucket, prefix} = ossConf;
    // const bucket0 = await checkOssBucket(accessId, accessKey, bucket)
    const oss = createOssClient(accessId, accessKey, bucket)
    const subPathOnOss = `${prefix||'dev'}/${ossFilename}`;
    return oss.put(subPathOnOss, srcFile).then(res=>{
        console.log(`upload to oss success, ${subPathOnOss}`)
        return res
    })
}

if (module === require.main) {
    const args = process.argv.slice(2)
    if (args[0] === 'custodian_token') {
        updateCustodianTokenFlag().then()
    } else if (args[0] === 'updateTotalSupply') {
        updateTotalSupply().then()
    } else if (args[0] === 'build_images') {
        buildImages().then(()=>{
            Token.sequelize.close().then()
        })
    } else {
        console.log(`Please use one of <updateTotalSupply | build_images | custodian_token>`)
    }
}
