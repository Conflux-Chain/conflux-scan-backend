import {Conflux, format} from "js-conflux-sdk";
import {PARSER_ERROR} from "js-conflux-sdk/src/ERROR_CODES";
import {Op} from 'sequelize'
import {NftMint, Token} from "../../model/Token";
import {init} from "./FixDailyTokenStat";
import {initCfxSdk} from "../common/utils";
import {decodeUtf8} from "./StringTool";
import * as oss from "ali-oss";
import {getAddrId} from "../../model/HexMap";
import {CONST} from "../common/constant";
import {StatApp} from "../../StatApp";
import {ethers} from "ethers";
import {decodeTxData} from "./TxTool";
import {safeAddErrorLog} from "../../monitor/ErrorMonitor";
import {Contract} from "../../model/Contract";

const abi = require('./abi');
const fs = require('fs');
const path = require('path');
const lodash = require('lodash');
const NodeCache = require( "node-cache" );
const cacheTtl = 60 * 10 // 10 minutes
const dbCache = new NodeCache({ maxKeys: 10000,  stdTTL: cacheTtl, checkperiod: 60})

export function addTokenCache(obj:{name?, symbol, decimals?, granularity?, base32:string}) {
    try {
        dbCache.set(obj.base32 || '', obj, cacheTtl)
    } catch (e){
        //error: Cache max keys amount exceeded
    }
}

export class TokenTool {
    protected cfx;
    public contract;

    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.contract = cfx.Contract({abi});
    }

    async getToken(address/*base32*/: string, epochNumber = undefined, useCache = false): Promise<{
        address: string, name: string, symbol: string, decimals: number, granularity: number,
    }> {
        if (useCache) {
            const cache = dbCache.get(address);
            if (cache) {
                return cache
            }
        }
        const savedFailure = await Contract.findOne({where: {base32: address}});
	    if (savedFailure?.nameSymbolFailed) {
            return {
                address, name: null, symbol: null, granularity: null, decimals: null,
            }
	    }
        return this.awaitObject({
            address,
            name: this.contract.name()
                .call({to: address}, epochNumber)
                .catch((e) => handlerCallError(`name`, address, e)),
            symbol: this.contract.symbol()
                .call({to: address}, epochNumber)
                .catch((e) => handlerCallError(`symbol`, address, e)),
            decimals: this.contract.decimals()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch((e) => handlerCallError(`decimals`,address, e)),
            granularity: this.contract.granularity()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch((e) => handlerCallError(`granularity`, address, e)),
        }).then(obj=>{
            try {
                dbCache.set(address, obj, cacheTtl)
            } catch (e){
                //error: Cache max keys amount exceeded
            }
            return obj;
        });
    }

    async getTokenTotalSupply(address, epochNumber = undefined, reportError = false) {
        return this.contract.totalSupply()
            .call({to: address}, epochNumber)
            .then(BigInt)
            .catch((e) => reportError ? rewriteCallContractError(e, 'totalSupply') : undefined);
    }

    async getTokenBalance(address, accountAddress, epochNumber, reportError = false) {
        return this.contract.balanceOf(accountAddress)
            .call({ to: address }, epochNumber)
            .then(BigInt)
            .catch((e) => reportError ? rewriteCallContractError(e, 'balanceOf') : undefined);
    }

    async getBalances(account, contracts, utilContract) {
        if (utilContract === undefined) {
            console.log('util contract not set.');
            return [];
        }
        return this.contract.getBalances(account, contracts)
            .call({ to: utilContract })
            .then((arr) => arr.map(BigInt))
            .catch((err) => {
                console.log('params:', account, contracts, utilContract);
                console.log(`get balances from util contract fail: `, err);
                throw new Error("failed to fetch balance.")
            });
    }

    async getEpochByEpochNumber(epochNumber: number) {
        const now = Math.floor(Date.now() / 1000);
        const pivotBlock = await this.cfx.getBlockByEpochNumber(epochNumber);
        if (!pivotBlock) {
            return null;
        }
        return {
            epochNumber,
            pivotHash: pivotBlock.hash,
            parentHash: pivotBlock.parentHash,
            timestamp: lodash.min([pivotBlock.timestamp, now]), // XXX: for filter negative timestamp
        };
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
            const parameters = ethers.utils.defaultAbiCoder.decode(['bytes','bytes'], data);
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

    decodeNameTagChanged(eventLog) {
        // see contracts/AddressMetadata.sol
        const { topics = [], data = '0x' } = eventLog;

        if (topics[0] === this.contract.NameTagChanged.signature && topics.length === 3) {
            const _abi = abi.find(e=>e.name==='NameTagChanged').inputs.slice(2);
            const parameters = ethers.utils.defaultAbiCoder.decode(_abi, eventLog.data);
            return {
                ...eventLog,
                auditor: `0x${topics[1].slice(-40)}`,
                addr: `0x${topics[2].slice(-40)}`,
                oldNameTag: parameters['0']['1'],
                oldWebsite: parameters['0']['2'],
                oldDesc: parameters['0']['3'],
                newNameTag: parameters['1']['1'],
                newWebsite: parameters['1']['2'],
                newDesc: parameters['1']['3'],
            };
        }

        return undefined;
    }

    decodeLabelChanged(eventLog) {
        // see contracts/AddressMetadata.sol
        const { topics = [], data = '0x' } = eventLog;
        //event LabelChanged(index_topic_1 address auditor, index_topic_2 address addr, string oldLabel, string newLabel)
        if (topics[0] === this.contract.LabelChanged.signature && topics.length === 3) {
            const parameters = ethers.utils.defaultAbiCoder.decode(['string','string'], data);
            return {
                ...eventLog,
                auditor: `0x${topics[1].slice(-40)}`,
                addr: `0x${topics[2].slice(-40)}`,
                oldLabel: parameters['0'],
                newLabel: parameters['1'],
            };
        }

        return undefined;
    }

    decodeBytes32NameTagChanged(eventLog) {
        // see contracts/AddressMetadata.sol
        const { topics = [], data = '0x' } = eventLog;
        // event Bytes32NameTagChanged(address indexed auditor, bytes32 indexed hex64, Bytes32NameTag oldNameTag, Bytes32NameTag newNameTag)
        if (topics[0] === this.contract.Bytes32NameTagChanged.signature && topics.length === 3) {
            const _abi = abi.find(e=>e.name==='Bytes32NameTagChanged').inputs.slice(2);
            const parameters = ethers.utils.defaultAbiCoder.decode(_abi, eventLog.data);
            return {
                ...eventLog,
                auditor: `0x${topics[1].slice(-40)}`,
                hex64: topics[2],
                oldNameTag: parameters['0']['1'],
                oldWebsite: parameters['0']['2'],
                oldDesc: parameters['0']['3'],
                newNameTag: parameters['1']['1'],
                newWebsite: parameters['1']['2'],
                newDesc: parameters['1']['3'],
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

    decodeERC20TransferPlus(eventLog = {}, copy = true) {
        // @ts-ignore
        const { topics = [], data = '0x' } = eventLog;

        if (topics[0] === this.contract.Transfer.signature && topics.length === 3 && data.length === 66) {
            const from = `0x${topics[1].slice(-40)}`;
            const to = `0x${topics[2].slice(-40)}`;
            const value = BigInt(data);
            if (!copy) {
                eventLog['from']  = from;
                eventLog["to"] = to;
                eventLog["value"] = value;
                return eventLog;
            }
            return {
                ...eventLog,
                from,
                to,
                value,
            }
        }

        return undefined;
    }

    decode721_1155_ApprovalForAll(eventLog = {}, copy = true) {
        return this.decodeApproval(eventLog, this.contract.ApprovalForAll, 'ApprovalForAll', copy)
    }

    decodeERC721_ERC20Approval(eventLog = {}, copy = true) {
        return this.decodeApproval(eventLog, this.contract.Approval, 'Approval', copy)
    }

    decodeApproval(eventLog = {}, event, type, copy = true) {
        // @ts-ignore
        const { topics = [], data = '0x' } = eventLog;
        // event Approval(address indexed owner, address indexed spender, uint value); 20
        // event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId); 721
        // event ApprovalForAll(address indexed owner, address indexed operator, bool approved); // 1155, 721
        if (topics[0] === event.signature &&
            ( (topics.length === 3 && data.length === 66)
            || (topics.length === 4 && data.length === 2) )
        ) {
            const owner = `0x${topics[1].slice(-40)}`;
            const spender = `0x${topics[2].slice(-40)}`;
            const value = BigInt(topics.length === 3 ? data : topics[3]);
            if (copy) {
                return {
                    ...eventLog,
                    from: owner, to: spender, value, type
                };
            } else {
                eventLog['from']  = owner;
                eventLog["to"] = spender;
                eventLog["value"] = value;
                eventLog["type"] = type;
                return eventLog;
            }
        }

        return undefined;
    }

    decodeERC721Transfer(eventLog = {}, copy = true) {
        // @ts-ignore
        const { topics = [], data = '0x' } = eventLog;

        // ERC721: Transfer(address indexed from, address indexed to, uint256 indexed value)
        if (topics[0] === this.contract.Transfer.signature && topics.length === 4 && data.length === 2) {
            const from = `0x${topics[1].slice(-40)}`;
            const to = `0x${topics[2].slice(-40)}`;
            const tokenId = BigInt(topics[3]);
            if (copy) {
                return {
                    ...eventLog,
                    from, to, tokenId,
                };
            } else {
                eventLog['from']  = from;
                eventLog["to"] = to;
                eventLog["tokenId"] = tokenId;
                return eventLog;
            }
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
            const parameters = ethers.utils.defaultAbiCoder.decode(['uint256','uint256'], data);
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
            const parameters = ethers.utils.defaultAbiCoder.decode(['uint256[]','uint256[]'], data);
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

    matchTrace(transactionTraceArray, transaction){
        if (!transactionTraceArray.length) {
            return[];
        }

        const stack = [];
        for(let i = 0; i < transactionTraceArray.length; i++){
            const nextTrace = transactionTraceArray[i];
            if(nextTrace.type !== CONST.TRACE_TYPE.CREATE && nextTrace.type !== CONST.TRACE_TYPE.CREATE_RESULT){
                continue;
            }
            if(nextTrace.type === CONST.TRACE_TYPE.CREATE){
                stack.push(i);
            }
            if(nextTrace.type === CONST.TRACE_TYPE.CREATE_RESULT){
                const creatTraceIndex = stack.pop();
                transactionTraceArray[creatTraceIndex].action.to = nextTrace.action.addr;
                transactionTraceArray[creatTraceIndex].action.outcome = nextTrace.action.outcome;
            }
        }
        if(stack.length > 0){
            const creatTraceIndex = stack.pop();
            transactionTraceArray[creatTraceIndex].action.to = transaction.contractCreated;
        }
        return transactionTraceArray;
    }

    sendAnnounceTransaction(array, options = {}) {
        return this.contract.announce(array)
            .sendTransaction(options)
            .executed();
    }
}

export async function base64ToPNG(token:Token, dir: string) {
    if (!token.icon) {
        // console.log(`icon is not present. ${token.symbol} ${token.name} ${token.base32}`)
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
    const addr = StatApp.isEVM ? format.hexAddress(token.base32) : token.base32;
    const filename = `${addr}${imageType}`;
    const absPath = path.resolve(dir, filename);
    fs.writeFileSync(absPath, data, 'base64');
    return {absPath, filename}
}

export function getImageDir() {
    const public_dir = __dirname + '/../../../public/images/';
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
    const config = await init()

    const cfx = await initCfxSdk(config.conflux)
    console.log(`networkId ${cfx.networkId} config ${JSON.stringify(config.conflux)}`);

    const tool = new TokenTool(cfx)
    return tool;
}

async function testParseAnnouncement(rpcUrl:string = "http://test.confluxrpc.com") {
    const cfx = await initCfxSdk({url: rpcUrl});
    const tool = new TokenTool(cfx);
    const abiStr = JSON.stringify(abi);
    async function test(tx: string, decodeInput = false) {
        if (decodeInput) {
            const txRaw = await cfx.getTransactionByHash(tx)
            console.log(`decode tx data`, decodeTxData(abiStr, txRaw.data))
        }
        const rcpt = await cfx.getTransactionReceipt(tx)
        for (const eventLog of rcpt.logs) {
            const fnArr = [
                tool.decodeAnnouncePlus,
                tool.decodeNameTagChanged,
                tool.decodeLabelChanged,
                (e) => {
                    console.log(`unknown event`, e)
                }
            ]
            for (const fn of fnArr) {
                const parsed = fn.call(tool, eventLog)
                if (parsed) {
                    delete parsed['data']
                    console.log(`ok ${fn.name}`, parsed.key?.toString('utf-8') || parsed)
                    break
                }
            }
        }
    }
    await test("0x50db76372727e27efa8325f51d447d5d87ec4792e7b8889eafef181fae4bfacd", true) // announce
    await test("0x67713b6186f930a846fc12dba1aa9aadf7e1011bf59ac64445c4c07022736938");
    await test("0x49cdf20f4dc25673546e4f025d568c8d1d873e61e09ad194302677ba951cb3f7");
    await test("0x93ca9e1b2b502fcfef4780794b6c0f39f258caadf163e25c25fb19def6771c35");
    await test("0xefb453b4333847fdc67f3ed7c44908169d100ce10d09ebf6adf51d53c478bece");
    console.log(`finished`)
    cfx.close()
}

async function testParseApproval(rpcUrl) {
    const cfx = await initCfxSdk({url: rpcUrl});
    const tool = new TokenTool(cfx);
    const txs = [
        // on net 1
        '0x4dadacf057cf66e1e2528b1377f19ec3ce0ddce2053bc6b400195a4677f130ad',//20
        '0x93c100e4b29e9bc93b2017b557fa5e678b721d28436c790f32b577d429dd4854',// 721
        '0xafcc64ee0d1bc8ef2983331373a0472f06e7616841bcaec594f22768b1379452', // 721 all
        '0xd1590405de1807f489b63c275bdbaada3e996da1f15279eb1def6d7e173f5cca', // 1155 all
    ]
    for (let tx of txs) {
        const {logs} = await cfx.getTransactionReceipt(tx)
        const approval =
            tool.decodeERC721_ERC20Approval(logs[0], false)
            || tool.decode721_1155_ApprovalForAll(logs[0], false)
        if (approval) {
            console.log(`check ok, it's ${approval["type"]} ${approval['value']}`)
        } else {
            console.log(`check fail, tx `, tx)
        }
    }
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
    const {accessId, accessKey, bucket, prefix} = ossConf || {}
    if (!accessId) {
        console.log(`oss not configured.`)
        return
    }
    console.log(`init oss, bucket ${bucket}, prefix ${prefix}`)
    return checkOssBucket(accessId, accessKey, bucket).then(res=>{
    }).catch(err=>{
        console.log(`check oss bucket fail: `, err)
        //process.exit(1)
    });
}
export async function uploadOss(srcFile, ossFilename) {
    if (!srcFile || !ossFilename) {
        return undefined
    }
    const {accessId, accessKey, bucket, prefix} = ossConf;
    if (!accessId) {
        return `/stat/${ossFilename}`;
    }
    // const bucket0 = await checkOssBucket(accessId, accessKey, bucket)
    const oss = createOssClient(accessId, accessKey, bucket);
    const subPathOnOss = `${prefix||'dev'}/${ossFilename}`;
    return oss.put(subPathOnOss, srcFile).then(res=>{
        console.log(`upload to oss success, ${subPathOnOss}`)
        return res
    })
}
export async function check721OwnerInDb() {
    const config = await init()

    const cfx = await initCfxSdk(config.conflux);
    console.log(`------------ networkId ${cfx.networkId} version ${await cfx.getClientVersion()} latestState ${(await cfx.getStatus()).latestState} -----`)

    const [, , cmd, contractIdStr] = process.argv
    if (contractIdStr) {
        const contractId = parseInt(contractIdStr)
        const token = await Token.findOne({where: {hex40id: contractId}, attributes: {exclude: ['icon']}})
        await checkNftMintForContract(contractId, cfx, token)
    } else {
        const tokens = await Token.findAll({
            where: {type: {[Op.in]: [
                'ERC721',
                        // 'ERC1155'
                    ]}, auditResult: true},
            attributes: {exclude: ['icon']}
        })
        for (let token of tokens) {
            await checkNftMintForContract(token.hex40id, cfx, token)
        }
    }
    await NftMint.sequelize.close()
    console.log(`${__filename} done`)
    process.exit(0)
}
async function checkNftMintForContract(contractId: number, cfx, token:Token) {
    if (!token) {
        console.log(`token is null`)
        return
    }
    console.log(`Token is ${token.type} [${token.name}] [${token.symbol}] , ${token.base32} hex id [${token.hex40id}]`);
    if (token.type !== 'ERC721') {
        console.log(`It's not ERC721 token. ${token.base32} [${token.name}] [${token.type}]`)
        return
    }
    const contract = cfx.Contract({abi, address: token.base32});
    const mintList = await NftMint.findAll({where: {contractId}})
    let matched = 0;
    let fixed = 0;
    for (let i = 0; i < mintList.length; i++) {
        const {toId, tokenId, updatedAt, id} = mintList[i]
        let owner: any;
        try {
            owner = await contract['ownerOf'](tokenId);
        } catch (e) {
            if ((e.message+e.data).includes('owner query for nonexistent token')) {
                owner = '0x0000000000000000000000000000000000000000'
            } else if (e.message.includes('length not match')) {
                const account = await cfx.getAccount(token.base32);
                if (account.codeHash === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470') {
                    console.log(`contract destroyed.`)
                    return
                }
            } else if (e.message.endsWith('reverted') || e.message.includes('hex length to large')) {
                console.log(`can not call ownerOf for ${contractId}, ${e} ${e.data || ''}`)
                return;
            } else {
                console.log(`call owner of fail, contract ${contractId} token ${tokenId}: ${e}`);
                continue
            }
        }
        const onChainOwnerId = await getAddrId(owner)
        if (toId != onChainOwnerId) {
            console.log(`owner not match, contract ${contractId}, owner on chain ${onChainOwnerId} != ${toId} in db, on chain ${owner} token id ${tokenId}`)
            await NftMint.update({toId: onChainOwnerId, updatedAt},{where: {id}})
            fixed ++
        } else {
            matched ++
        }
    }
    if (mintList.length === matched) {
        console.log(`ALL is MATCHED`)
        return;
    }
    console.log(`done. in db mint ${mintList.length}, contract ${contractId
    }, owner matched ${matched}, fixed ${fixed}`);
}
// node stat/dist/service/tool/TokenTool.js check721OwnerInDb 1
if (module === require.main) {
    const args = process.argv.slice(2)
    const [,,cmd, arg1, arg2] = process.argv;
    if (args[0] === 'check721OwnerInDb') {
        check721OwnerInDb().then()
    } else if (args[0] === 'updateTotalSupply') {
        updateTotalSupply().then()
    } else if (args[0] === 'testParseAnnouncement') {
        testParseAnnouncement().then()
    } else if (args[0] === 'testParseApproval') {
        testParseApproval(arg1).then()
    } else if (args[0] === 'build_images') {
        const space = args[1]
        if (space !== 'core' && space !== 'evm') {
            console.log(`Usage: node TokenTool.js build_images <core|evm>`)
            process.exit(2)
        }
        StatApp.isEVM = space === 'evm'
        buildImages().then(()=>{
            Token.sequelize.close().then()
        })
    } else {
        console.log(`Please use one of <updateTotalSupply | build_images | custodian_token>`)
    }
}

function rewriteCallContractError(e: Error|any, fn: string) {
    const {message, expect, got, } = e?.message || {};
	if ((expect == 64 && got == 0 && message === 'length not match')
        || e?.message === '{"message":"length not match","expect":64,"got":0,"stream":{"string":"0x","index":2}}') {
        e.message = `the contract does not support this function [${fn}], please contact the owner of the contract.`;
	}
    return e;
}


function handlerCallError(fn: string, addr: string, err: Error) {
    const biz = `${fn}-${addr}`;
    if (err.message === 'Transaction reverted'
    || err.message === '{"message":"length not match","expect":2,"got":0,"stream":{"string":"0x","index":2}}'
    || err.message === '{"message":"length not match","expect":64,"got":0,"stream":{"string":"0x","index":2}}'
    || err.message === 'Transaction execution failed' // internal contract outputs
    || err.message?.startsWith('execution reverted') // evm
    || ( err.message?.startsWith('(Invalid input|args)') && err["code"] === PARSER_ERROR ) // invalid response, decoding failure
    ) {
        console.log(`failed to call ${biz} , message ${err.message}`)
        if (fn == 'name' || fn == 'symbol') {
            saveNameSymbolFailure(addr);
        }
        return;
    }
    safeAddErrorLog('token-tool', biz, err).then();
    console.log(`failed to call ${biz} , message ${err.message}`, err)
}

async function saveNameSymbolFailure(addr: string) {
    if (!Contract.sequelize) {
        return
    }
    const hexId = await getAddrId(addr);
    if (!hexId) {
        return;
    }
    const contract = await Contract.findOne({where: {base32: addr}});
    if (contract?.nameSymbolFailed) {
        return;
    }
    if (contract) {
        contract.nameSymbolFailed = true;
        contract.save().catch(e=>{
            console.log(`${__filename} save name-symbol failure:`, e)
        })
    } else {
        Contract.upsert({
            hex40id: hexId, base32: addr,
            nameSymbolFailed: true
        }).catch(e=>{
            safeAddErrorLog('token-tool', `save-name-symbol-failure-${addr}`, e);
            console.log(`${__filename} upsert name-symbol failure:`, e)
        })
    }
}
