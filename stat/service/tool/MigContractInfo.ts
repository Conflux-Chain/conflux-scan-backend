import {loadConfig} from "../../config/StatConfig";
import {saveAbiInfo} from "../../model/ContractInfo";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import {ContractVerify, ContractVerify2} from "../../model/ContractVerify";
import {Conflux} from "js-conflux-sdk";
import {initCfxSdk} from "../common/utils";
import {TraceCreateContract} from "../../model/TraceCreateContract";
import {Hex40Map, makeId} from "../../model/HexMap";
import {literal, Op, QueryTypes} from "sequelize";
import {ContractQuery} from "../ContractQuery";
import {EpochSync} from "../EpochSync";
import {AddressNft, AddressNfts} from "../../model/AddrNft";
import {IS_EVM2, KEY_FASTEST_IPFS_GATEWAY, KV} from "../../model/KV";
import {Erc1155Data, NftMint, Token, Token2} from "../../model/Token";
import {sleep} from "./ProcessTool";
import {MetaStatus, NftMeta} from "../nftchecker/NftMetaStorage";

const fs = require('fs');
const lodash = require('lodash');
const { format, sign } = require('js-conflux-sdk');
const superagent = require('superagent');

let type: number;
let cfx:Conflux;
let contractQuery: ContractQuery;
let base32;
let epochSync;
let times;
let rows;
let amount;
let peerUri
let localAPIUri
let debug
let contractAddress
let max

async function init() {
    const config = loadConfig('Prod')

    cfx = await initCfxSdk(config.conflux);

    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    contractQuery = new ContractQuery({cfx});
    epochSync = new EpochSync({cfx});

    StatApp.isEVM = await KV.getSwitch(IS_EVM2);
}

async function parseVerified(base32) {
    const v = await ContractVerify.findOne({attributes: ['abi'], where: {base32, verifyResult: true}});
    const abi = JSON.parse(v.abi);
    await saveAbiInfo(abi);
    console.log(`generate abi info for ${base32}`);
}

export async function batchParseVerified() {
    let total = 0;
    let count;
    let cursor = 0;
    do{
        const items = await ContractVerify.findAll({
            attributes: ['id', 'abi', 'base32'],
            where: {verifyResult: true, id: {[Op.gte]: cursor}},
            order:[["id","asc"]],
            limit: 100
        });
        count = items?.length;

        if(count) {
            for (const item of items) {
                const abi = JSON.parse(item.abi);
                try{
                    await saveAbiInfo(abi);
                } catch (e) {
                    console.log(`saveAbiInfo`, item.base32, e);
                }
            }
            total += count;
            cursor = items[items.length-1].id + 1;
            console.log(`generate abi info, total ${total}`);
        }
    }while (count);
    console.log(`generate abi info, done!`)
}

async function paddingCursorIdForAddressTransfer(times: number, rows: number) {
    let cursorId = 0;
    let timesCounter = 0;
    do{
        timesCounter = timesCounter + 1;
        if(timesCounter > times) return;

        const addressNftArray: AddressNft[] =  await AddressNft.sequelize.query(
            `select * from address_nft where cursorId is null order by createdAt asc limit ?;`,
            {type: QueryTypes.SELECT, replacements: [rows], raw: true/*, logging: sql => console.log(`AddressNft.query ${sql}`)*/ });
        if(!addressNftArray?.length){
            return;
        }

        const maxCursorId: number = await AddressNft.max('cursorId')
        if(maxCursorId){
            cursorId = maxCursorId;
        }

        for (const addressNft of addressNftArray) {
            cursorId = cursorId + 1;
            await AddressNft.update({cursorId}, {
                where: {addressId: addressNft.addressId , contractId: addressNft.contractId, tokenId: addressNft.tokenId},
                /*logging: sql => console.log(`AddressNft.update cursorId ${cursorId} ${sql}`)*/
            });
            if(cursorId % 1000 === 0) {
                console.log(`cursorId ------ ${cursorId}`)
            }
        }
    } while (true)
}

const KEY_CURSOR = 'KEY_CURSOR';
async function paddingIdForAddressTransfer(times: number, rows: number) {
    let cursorId = 0;
    let timesCounter = 0;
    do{
        timesCounter = timesCounter + 1;
        if(timesCounter > times) return;

        // get cursor
        const lastCursorId = await KV.getNumber(KEY_CURSOR, 0);
        if(lastCursorId > 0) {
            cursorId = lastCursorId;
        }

        // query
        const addressNftArray: AddressNft[] =  await AddressNft.sequelize.query(
            `select * from address_nft where cursorId > ? order by cursorId asc limit ?;`,
            {type: QueryTypes.SELECT, replacements: [cursorId, rows], raw: true/*, logging: sql => console.log(`AddressNft.query ${sql}`)*/ });
        if(!addressNftArray?.length){
            return;
        }
        cursorId = addressNftArray[addressNftArray?.length - 1].cursorId; // for next loop

        // build and persist
        const addressNftsArray = [];
        for (const addressNft of addressNftArray) {
            const item = lodash.pick(addressNft, ['addressId', 'contractId', 'tokenId', 'value', 'type', 'createdAt', 'updatedAt']);
            addressNftsArray.push(item);
        }
        await AddressNfts.sequelize.transaction(async (dbTx) => {
            await AddressNfts.bulkCreate(addressNftsArray, {transaction: dbTx});
            await KV.upsert({key: KEY_CURSOR, value: `${cursorId}`}, {transaction: dbTx});
        });
        console.log(`timesCounter ------ ${timesCounter}`)
    } while (true)
    console.log(`done ------ cursorId ${cursorId}`)
}

async function paddingUpdatedCursor(times: number, rows: number) {
    let lastId = 0;
    let timesCounter = 0;
    do{
        timesCounter = timesCounter + 1;
        if(timesCounter > times) break;

        const list = await AddressNfts.findAll({
            where: {id: {[Op.gt]: lastId}, updatedCursor: null},
            order: [['id', 'asc']],
            limit: rows,
            raw: true,
        })

        const fetchSize = list?.length;
        if(fetchSize) {
            for (const addrNfts of list) {
                const {addressId: toId, contractId, tokenId, type, updatedCursor: dbCursor,value} = addrNfts;
                if(dbCursor) continue;
                if(type !== 21 && type !== 55){
                    throw new Error(`invalid nft type`);
                }

                let latestTransferTime;
                if(type === 21) {
                    /*let start = Date.now();*/
                    let latestTransfer: any = await NftMint.findOne({where: {contractId, toId, tokenId}});
                    if(!latestTransfer){
                        latestTransfer = {updatedAt: addrNfts.updatedAt};
                        /*console.log(`contractId ${contractId} tokenId ${tokenId} toId ${toId} value ${value}`)*/
                    }
                    /*const elapsed2 = Date.now() - start;
                    console.log(`721  elapsed2 ${elapsed2}`)*/
                    latestTransferTime = latestTransfer.updatedAt;
                } else{
                    /*let start = Date.now();*/
                    let latestTransfer: any = await Erc1155Data.findOne({where: {contractId, addressId: toId, tokenId}});
                    if(!latestTransfer) {
                        latestTransfer = {updatedAt: addrNfts.updatedAt};
                        console.log(`contractId ${contractId} tokenId ${tokenId} toId ${toId} value ${value}`)
                    }
                    /*const elapsed2 = Date.now() - start;
                    console.log(`1155  elapsed2 ${elapsed2}`)*/
                    latestTransferTime = latestTransfer['updatedAt'];
                }
                const updatedCursor = Number(`${latestTransferTime.getTime().toString().substring(0, 10)}000000`);
                await AddressNfts.update({updatedAt: latestTransferTime, updatedCursor}, {where: {id: addrNfts.id}});
            }

            const last = list[list.length-1];
            lastId = last.id;
            await sleep(100);
        }
        console.log(`${new Date()}paddingUpdatedCursor ------ timesCounter:${timesCounter} fetchSize:${fetchSize} lastId:${lastId}`);
    } while (true)
    console.log(`done`)
}

const KEY_UPDATED_CURSOR = 'KEY_UPDATED_CURSOR';
async function serializeUpdatedCursor(times: number) {
    let timesCounter = 0;
    const step = 1000000;
    do{
        /*console.log(`---1---`)*/
        timesCounter = timesCounter + 1;
        if(timesCounter > times) break;
        if(timesCounter % 100 === 0) {
            await sleep(100);
            console.log(`${new Date()}serializeUpdatedCursor ------ timesCounter:${timesCounter}`);
        }

        const lastCursor = await KV.getNumber(KEY_UPDATED_CURSOR, 0);
        const nextCursor = lastCursor + step;
        /*console.log(`---2--- lastCursor ${lastCursor}`)*/
        const row = await AddressNfts.findOne({
            where: {
                [Op.and]: [
                    {updatedCursor: {[Op.gte]: nextCursor}},
                    {updatedCursor: {[Op.lt]: 1682205766000000}},
                ]
            },
            order: [['updatedCursor', 'asc']],
            limit: 1,
            raw: true,
        })
        /*console.log(`---3--- ${JSON.stringify(row)}`)*/
        if(!row){
           break;
        }

        const rowsSameCursor = await AddressNfts.findAll({
            where: {updatedCursor: row.updatedCursor},
            raw: true,
        })
        /*console.log(`---5--- ${rowsSameCursor.length}`)*/
        if(rowsSameCursor.length < 2){
            /*console.log(`---6--- lastCursor ${lastCursor}`)*/
            await KV.saveNumber(KEY_UPDATED_CURSOR, row.updatedCursor, undefined);
            continue
        }

        const toUpdateArray = [];
        let index = 0;
        rowsSameCursor.forEach(item => {
            const updatedCursor = Number(`${item.updatedCursor.toString().substring(0, 10)}${(index++).toString().padStart(6, '0')}`);
            toUpdateArray.push({id: item.id, updatedCursor});
        })
        /*console.log(`toUpdateArray ${JSON.stringify(toUpdateArray)}`)*/

        await AddressNfts.sequelize.transaction(async (dbTx) => {
            for (const toUpdate of toUpdateArray) {
                await AddressNfts.update({updatedCursor: toUpdate.updatedCursor}, {where: {id: toUpdate.id}});
            }
            await KV.saveNumber(KEY_UPDATED_CURSOR, row.updatedCursor, dbTx);
        });
    } while (true)
    console.log(`done`)
}

async function statNft(address) {
    const base32 = format.address(address, StatApp.networkId);
    let token = await Token.findOne({where: {base32: base32}, attributes: {exclude: ['icon']}})

    let skip = 0;
    let pageSize = 5000;
    let authorTokenIdMap = {}; // author -> counter
    let tokenIdArrayWithoutAuthor = []

    while (true) {
        const nftArray = await NftMeta.findAll({
            where: {contractId: token.hex40id},
            order: [['epochNumber', 'asc']],
            offset: skip,
            limit: pageSize,
            raw: true,
            logging: console.log
        });

        const nftSize = nftArray?.length
        console.log(`skip ${skip} nftSize ${nftSize}`)
        if (!nftSize) {
            break
        }

        nftArray.filter(n => n.status === 22).map(n => {
            const o = JSON.parse(n.content);
            if(!o?.properties?.author) {
                tokenIdArrayWithoutAuthor.push(n.tokenId)
            }
            return o?.properties?.author || 'author-less'
        }).reduce((obj, author)=> {
            if(!obj[author]) {
                obj[author] = 1
            } else{
                obj[author]++
            }
            return obj
        }, authorTokenIdMap)


        skip += nftSize;
    }

    let authorTokenIdArray = []
    Object.keys(authorTokenIdMap).forEach(
        author => authorTokenIdArray.push({author, tokenIds: authorTokenIdMap[author]})
    )
    authorTokenIdArray = lodash.orderBy(authorTokenIdArray, 'tokenIds', 'desc')

    let content = '\ufeffauthor,uniqueTokenIds\n';
    authorTokenIdArray.forEach(item => {
        content += `${item.author},${item.tokenIds}\n`;
    });
    fs.writeFile(`./${token.symbol||token.name}-${Date.now()}.csv`, content, (e) => console.error(`toCSV`, e));
    console.log(`done!`);

    let cntr = 0
    do{
        console.log(tokenIdArrayWithoutAuthor[cntr++])
    }while (cntr < 100)
}



/*async function fixRepeatedUpdatedCursor(updatedCursorArray: number[]) {
    for (const updatedCursor of updatedCursorArray) {
        const strUpdatedCursor = updatedCursor.toString().substring(10);
        /!*if(strUpdatedCursor !== '000000') continue;*!/

        async function getTransfer(row) {
            const {addressId, contractId, tokenId} = row;
            const model = row.type === 21 ? AddressErc721Transfer : AddressErc1155Transfer;
            let transfer: any = await model.findOne({
                where: {addressId, tokenId},
                order: [['epoch', 'desc']],
                raw: true,
                logging: console.log
            });
            if(!transfer) {
                const model = row.type === 21 ? Erc721Transfer : Erc1155Transfer;
                transfer = await model.findOne({
                    where: {contractId, tokenId},
                    order: [['epoch', 'desc']],
                    raw: true,
                    logging: console.log
                });
            }
            return transfer;
        }

        const rows = await AddressNfts.findAll({where: {updatedCursor}, raw: true});
        if(rows.length === 2) {
            const row1 = rows[0];
            const row2 = rows[1];
            const transfer1 = await getTransfer(row1);
            const transfer2 = await getTransfer(row2);
            if(!transfer1) {
                console.log(`no transfer found for ${JSON.stringify(row1)}`)
                continue;
            }
            if(!transfer2) {
                console.log(`no transfer found for ${JSON.stringify(row2)}`)
                continue;
            }
            if(transfer1.epoch > transfer2.epoch) {
                await AddressNfts.update({updatedCursor: updatedCursor+ 500000}, {where:{id: row1.id}});
            } else if(transfer2.epoch > transfer1.epoch) {
                await AddressNfts.update({updatedCursor: updatedCursor+ 500000}, {where:{id: row2.id}});
            } else {
                console.log(`epoch equals between row1 ${row1.id} and rows ${row2.id}`)
            }
        }
    }
}*/

async function testUpdateByLiteral(amount) {
    const primaryKey = {contractId: 105, addressId: 366, tokenId: '1'};
    /*await Erc1155Data.update(
        {'amount': Sequelize.literal(`amount - ${Number(amount)}`)},
        {where: primaryKey, logging: sql => console.log(`sql------ ${sql}`)}
    );*/

    // check if update updatedAt field when using update of sequelize
    /*await AddressNfts.update(
        {'value': Sequelize.literal(`value - ${Number(amount)}`)},
        {where: primaryKey, logging: sql => console.log(`sql------ ${sql}`)}
    );*/

    // check if update updatedAt field when using increment of sequelize
    await AddressNfts.increment(
        {'value': -Number(amount)},
        {where: primaryKey, logging: sql => console.log(`sql------ ${sql}`)}
    );
}

async function addCodeHashForVerify() {
    const verifyArray = await ContractVerify.findAll({
        attributes: ['id', 'base32', 'codeHash'],
        where: {verifyResult: true},
        raw: true
    });

    for(const verify of verifyArray){
        if(!verify.codeHash){
            const code = await cfx.getCode(verify.base32);
            if(code === '0x'){
                console.log(`addCodeHashForVerify------base32:${verify.base32}:destroyed------code:${code}`);
                continue;
            }
            const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');
            await ContractVerify.update({codeHash}, {where: {id: verify.id}});
            console.log(`addCodeHashForVerify------base32:${verify.base32}------codeLength:${code?.length}------codeHash:${codeHash}`);
        }
    }
    console.log(`addCodeHashForVerify------done!`);
}

async function addCodeHashForTrace() {
    const traceArray = await TraceCreateContract.findAll({
        attributes: ['id', 'to', 'codeHash'],
        raw: true
    });

    for(const trace of traceArray){
        if(!trace.codeHash){
            const hex40 = await Hex40Map.findOne({where: {id: trace.to}});
            const hex = `0x${hex40.hex}`;
            const base32 =  format.address(hex, StatApp.networkId);
            const code = await cfx.getCode(base32);
            if(code === '0x'){
                console.log(`addCodeHashForTrace------base32:${base32}:destroyed------code:${code}`);
                continue;
            }
            const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');
            await TraceCreateContract.update({codeHash}, {where: {id: trace.id}});
            console.log(`addCodeHashForTrace------base32:${base32}------codeLength:${code?.length}------codeHash:${codeHash}`);
        }
    }
    console.log(`addCodeHashForTrace------done!`);
}

async function addMatchedVerify() {
    const traceCreateArray = await TraceCreateContract.findAll({
        attributes: ['id', 'to'],
        order: [['blockTime', 'ASC']],
        raw: true
    });

    for(const traceCreate of traceCreateArray){
        const toHex40Bean = await Hex40Map.findOne({where: {id: traceCreate.to}});
        if(!toHex40Bean){
            console.log(`addMatchedVerify------traceCreateId:${traceCreate.id}, toHex40Bean not exist!`);
            continue;
        }
        const base32 = format.address(`0x${toHex40Bean.hex}`, StatApp.networkId);

        const ownerVerify = await ContractVerify.findOne({
            where: {base32, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if(ownerVerify){
            continue;
        }

        const code = await cfx.getCode(base32);
        if(code === '0x'){
            continue;
        }
        const codeHash = sign.keccak256(Buffer.from(code)).toString('hex');

        const matchVerify = await ContractVerify.findOne({
            where: {codeHash, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        if(!matchVerify) {
            continue;
        }

        const matchRecord = lodash.assign(matchVerify, {id: undefined, base32, implementation: null});
        await ContractVerify.create(matchRecord);
        console.log(`addMatchedVerify------base32:${base32}------matchedContract:${matchVerify.base32}`);
    }
    console.log(`addMatchedVerify------done!`);
}

async function fixConstructorArgsForSimilarVerify() {
    const verifyArray = await ContractVerify.findAll({
        attributes: ['id', 'base32', 'similarMatch'],
        where: {verifyResult: true, similarMatch: {[Op.ne]: null}},
        raw: true
    });

    for(const verify of verifyArray){
        const similarVerify = await ContractVerify.findOne({
            attributes: ['id', 'base32', 'constructorArgs'],
            where: {base32: verify.similarMatch, verifyResult: true},
            raw: true
        });
        const bytecode = await contractQuery.exactBytecode({address: similarVerify.base32,
            constructorArgs: similarVerify.constructorArgs});
        const constructorArgs = await contractQuery.exactConstructorArgs({address: verify.base32, bytecode});

        await ContractVerify.update({constructorArgs}, {where: {id: verify.id}});
        console.log(`fixConstructorArgsForSimilarVerify------base32:${verify.base32}------constructorArgs:${constructorArgs?.length}`);
    }
    console.log(`fixConstructorArgsForSimilarVerify------done!`);
}

/*async function fixMinimalProxyContract() {
    const addressArray = [
        'net71:aacw3z94b49etazfs9suyyjtrk388s7d868nars6sm',
    ];
    for(const address of addressArray) {
        const implVerify = await ContractVerify.findOne({
            where: {base32: address, verifyResult: true},
            order: [['updatedAt', 'ASC']],
            raw: true
        });
        await contractQuery.verifyMinimalProxy({address, implVerifyId: implVerify.id});
    }
}*/

async function fixMinimalProxyContract() {
    const traceArray = await TraceCreateContract.findAll({
        attributes: ['id', 'to', 'codeHash'],
        raw: true
    });

    for(const trace of traceArray){
        const hex40 = await Hex40Map.findOne({where: {id: trace.to}});
        const address = `0x${hex40.hex}`;
        const isEIP1167 = await epochSync.verifyMinimalProxy({address});
        if(isEIP1167){
            console.log(`addCodeHashForTrace------address:${address}`);
        }
    }
    console.log(`addCodeHashForTrace------done!`);
}

async function searchBeaconContract() {
    const addressArray = [
    'cfxtest:acb9bf4bn98fy77smxjrk1w457gfk6v2fu2r98fwx4',
    'cfxtest:acfdkcps1z6w2ucurjxy7r3fap30pfr1keu646x7sr',
    'cfxtest:acgp28u5act64tcza6s8w248nthw17nxz66yp7n1k1',
    'cfxtest:acct10x2r3g01hw2fg74cz6y6gg0nx7anua9zam3he',
    'cfxtest:acbau5481kytuwh3kf29h1gn5vk7abs3ee3zd1xfh8',
    ];
    for(const address of addressArray) {
        const info = await contractQuery.queryImplementation(address)
        if(info?.beacon) {
            info['proxy'] = address;
            console.log(`${JSON.stringify(info)}`);
        }
    }
}

import {CONST} from "../common/constant"
import {u} from "@web3identity/address-encoder/lib/groestl-hash-js/op";
import zlib from "zlib";
import {TokenSecurityAudit, TokenSecurityAudit2} from "../../model/TokenSecurityAudit";
import {Contract, Contract2} from "../../model/Contract";
const licenseMap = {}
Object.keys(CONST.LICENSE).forEach(k => {
    const v = CONST.LICENSE[k]
    licenseMap[v.code] = k
})

// uri
// coreSpace mainNet https://www-stage.confluxscan.io
//           testNet https://testnet-stage.confluxscan.io
// evmSpace  mainNet https://evm-stage.confluxscan.io
//           testNet https://evmtestnet-stage.confluxscan.io
const KEY_SYNC_TOKEN = "KEY_SYNC_TOKEN_BY_PEER"
async function syncTokenFromPeer(uri, max) {
    while(true) {
        let id = await KV.getNumber(KEY_SYNC_TOKEN, 0)

        const r = await httpGet(`${uri}/stat/token/sync?id=${++id}`)
        if(r?.token) {
            const t = r.token
            let hex = await Hex40Map.findOne({where: {hex: format.hexAddress(t.base32).substr(2)}})
            if(!hex) {
                hex = {} as Hex40Map
                hex.id = (await makeId(format.hexAddress(t.base32))).id;
            }

            t.id = undefined
            t.hex40id = hex.id
            t.icon = t.icon ? Buffer.from(t.icon).toString() : undefined
            const r1 = await Token2.create(t as Token2)

            if(r?.audit) {
                const a = r.audit
                a.id = undefined
                a.hex40id = hex.id
                await TokenSecurityAudit2.create(a as TokenSecurityAudit2)
            }
            console.log(`Success sync ${id} ${t.base32} ${t.name} ${t.symbol}`)
        }

        await KV.upsert({key: KEY_SYNC_TOKEN, value: `${id}`})
        if(id >= max) {
            console.log(`Done`)
            break
        }
    }
}

// uri
// coreSpace mainNet https://www-stage.confluxscan.io
//           testNet https://testnet-stage.confluxscan.io
// evmSpace  mainNet https://evm-stage.confluxscan.io
//           testNet https://evmtestnet-stage.confluxscan.io
const KEY_SYNC_VERIFY = "KEY_SYNC_VERIFY_BY_PEER"
async function syncVerifyFromPeer(uri: string, max) {
    const key = uri.endsWith('.io') ? `${KEY_SYNC_VERIFY}_HK` : `${KEY_SYNC_VERIFY}_BJ`
    while(true) {
        let id = await KV.getNumber(key, 0)

        const v = await httpGet(`${uri}/stat/verify/sync?id=${++id}`)
        if(v?.verifyResult) {
            const cv = await ContractVerify2.findOne({where:{base32: v.base32}})
            if(!cv) {
                v.id = undefined
                const r = await ContractVerify2.create(v as ContractVerify2)
                console.log(`Success sync ${id} ${r.base32} ${r.name}`)
            }
        }

        await KV.upsert({key: key, value: `${id}`})
        if(id >= max) {
            console.log(`Done`)
            break
        }
    }
}

// uri
// coreSpace mainNet https://www-stage.confluxscan.io
//           testNet https://testnet-stage.confluxscan.io
// evmSpace  mainNet https://evm-stage.confluxscan.io
//           testNet https://evmtestnet-stage.confluxscan.io
const KEY_SYNC_CONTRACT = "KEY_SYNC_CONTRACT_BY_PEER"
async function syncContractFromPeer(uri: string, max) {
    const key = uri.endsWith('.io') ? `${KEY_SYNC_CONTRACT}_HK` : `${KEY_SYNC_CONTRACT}_BJ`
    while(true) {
        let id = await KV.getNumber(key, 0)

        const v = await httpGet(`${uri}/stat/contract/sync?id=${++id}`)
        if(v) {
            const c = await Contract2.findOne({where:{base32: v.base32}})
            if(!c) {
                let hex = await Hex40Map.findOne({where: {hex: format.hexAddress(v.base32).substr(2)}})
                if(!hex) {
                    hex = {} as Hex40Map
                    hex.id = (await makeId(format.hexAddress(v.base32))).id;
                }

                v.id = undefined
                v.hex40id = hex.id
                v.icon = v.icon ? Buffer.from(v.icon).toString() : undefined
                await Contract2.create(v as Contract2)
            }
            console.log(`Success sync ${id} ${v.base32} ${v.name}`)
        }

        await KV.upsert({key: key, value: `${id}`})
        if(id >= max) {
            console.log(`Done`)
            break
        }
    }
}

async function httpGet(uri) {
    let result

    while (true){
        try{
            const resp = await superagent.get(uri).timeout({response: 30_000, deadline: 30_000})
            const body = lodash.get(resp, ['body'])
            if(!Object.keys(body).length) {
                console.log(`Fail http get! null ${uri} http status ${resp.status}`)
                break
            }

            const success = StatApp.isEVM ? (body?.status === '1') : (body?.code === 0)
            if(!success) {
                console.error(`Fail http get! ${uri}`)
                throw new Error(`Fail http get! ${uri}`)
            }

            const data = StatApp.isEVM ? lodash.get(resp, ['body', 'result']) : lodash.get(resp, ['body', 'data']) // core space body: {"code":0,"message":"","data":{"code":429,"message":"Too many requests, path /stat/contract/by-address. Allow 10/s"}}
            const code = data?.code
            if(code && Number(code) === 429) {
                await sleep(500)
                continue
            }

            result = data
        }catch (e){
            const err = `${e.message}`
            if(err.includes('Aborted')) {
                continue
            }
            throw e
        }
        break
    }

    return result
}

async function run() {
    await init();
    if(type === 1){
        await addCodeHashForVerify();
    }
    if(type === 2){
        await addCodeHashForTrace();
    }
    if(type === 3){
        await addMatchedVerify();
    }
    if(type === 4) {
        await fixConstructorArgsForSimilarVerify();
    }
    if(type === 5) {
        await fixMinimalProxyContract();
    }
    if(type === 6) {
        if(base32 === '0') {
            await batchParseVerified();
        } else{
            await parseVerified(base32);
        }
    }
    if(type === 7) {
        await paddingCursorIdForAddressTransfer(times, rows);
    }
    if(type === 8) {
        await paddingIdForAddressTransfer(times, rows);
    }
    if(type === 9) {
        await testUpdateByLiteral(amount);
    }
    if(type === 10) {
        await searchBeaconContract();
    }
    if(type === 11) {
        await paddingUpdatedCursor(times, rows);
    }
    if(type === 12) {
        await serializeUpdatedCursor(times);
    }
    if(type === 20) {
        await statNft(base32)
    }
    if(type === 21) {
        await syncTokenFromPeer(peerUri, max)
    }
    if(type === 22) {
        await syncVerifyFromPeer(peerUri, max)
    }
    if(type === 23) {
        await syncContractFromPeer(peerUri, max)
    }
}
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0]);
type = Number(args[1]);

if(type === 6 || type === 20) {
 base32 = args[2];
}

if(type === 7 || type === 8 || type === 11 || type === 12) {
    times = Number(args[2]);
    if(args[3]) {
        rows = Number(args[3]);
    }
}

if(type === 9) {
    amount = args[2];
}

if(type === 21 || type === 22 || type === 23) {
    peerUri = args[2]
    max = Number(args[3]);
}

run().then();
