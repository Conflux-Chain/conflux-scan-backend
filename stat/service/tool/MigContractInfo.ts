import {loadConfig} from "../../config/StatConfig";
import {saveAbiInfo} from "../../model/ContractInfo";
import { StatApp } from "../../StatApp";
import {createDB, initModel} from "../DBProvider";
import {ContractVerify} from "../../model/ContractVerify";
import {Conflux} from "js-conflux-sdk";
import {patchHttpProvider} from "../common/utils";
import {ContractDestroy, TraceCreateContract} from "../../model/TraceCreateContract";
import {Hex40Map} from "../../model/HexMap";
import {Op, QueryTypes, Sequelize} from "sequelize";
import {ContractQuery} from "../ContractQuery";
import {EpochSync} from "../EpochSync";
import {AddressNft, AddressNfts} from "../../model/AddrNft";
import {Epoch, EpochNftTransfer} from "../../model/Epoch";
import {FullMinerBlock} from "../../model/FullMinerBlock";
import {AddressTransfer} from "../../model/AddrTransfer";
import {NftMeta} from "../nftchecker/NftMetaStorage";
import {CensorItem} from "../../model/CensorItem";
import {KV} from "../../model/KV";
import {Erc1155Data, NftMint} from "../../model/Token";
import {AddressErc721Transfer, Erc721Transfer} from "../../model/Erc721Transfer";
import {AddressErc1155Transfer, Erc1155Transfer} from "../../model/Erc1155Transfer";
import {AddressNftTransfer, NftTransfer} from "../../model/NftTransfer";
import {sleep} from "./ProcessTool";

const lodash = require('lodash');
const { format, sign } = require('js-conflux-sdk');

let type: number;
let cfx:Conflux;
let contractQuery: ContractQuery;
let base32;
let epochSync;
let times;
let rows;
let amount;

async function init() {
    const config = loadConfig('Prod')

    cfx = new Conflux(config.conflux);
    await cfx.updateNetworkId();
    patchHttpProvider(cfx, config.conflux);

    let seq = createDB(config.databaseRW)
    await seq.sync({})
    await initModel(seq)

    contractQuery = new ContractQuery({cfx});
    epochSync = new EpochSync({cfx});
}

async function parseVerified(base32) {
    const v = await ContractVerify.findOne({attributes: ['abi'], where: {base32, verifyResult: true}});
    const abi = JSON.parse(v.abi);
    await saveAbiInfo(abi);
    console.log(`generate abi info for ${base32}`);
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

async function fixRepeatedUpdatedCursor(updatedCursorArray: number[]) {
    for (const updatedCursor of updatedCursorArray) {
        const strUpdatedCursor = updatedCursor.toString().substring(10);
        /*if(strUpdatedCursor !== '000000') continue;*/

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
}

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
    'cfxtest:acctgrbsj2bgnyrcsh8b1zx2yru4wjessjjrmhmpe0',
    'cfxtest:achb3eaz229kg2pj1utp1v4yh5d5mxwd661s7vpahn',
    'cfxtest:acbn15vsj0trxzta39gngcs8skkft9h3yjbrd8wvxd',
    'cfxtest:acfnpy71hjhamy075xyps56124zje5154ux9nte7vt',
    'cfxtest:achamkxtk3yn534h483vdvv0kcffwr221uyw9xnucr',
    'cfxtest:acaa9nxn17b3yuscf9911yhg32yx0tdbaewdb73jp2',
    'cfxtest:acfnwua5hph4ne4j0an9anc5kp1fnuzgku9g2p9kpc',
    'cfxtest:acgwa148z517jj15w9je5sdzn8p8j044kjrvjz92c1',
    'cfxtest:ach02j5d0zmz4e8gm4wuhyffm73417xzdj3g603syb',
    'cfxtest:acaa0t3x9539vdysh1es8e09dw0u6nmy52s4a6ekbc',
    'cfxtest:acah03wpdvvndyxyet1vwze1hh6k0deskpnc7arv7s',
    'cfxtest:acbsj70eeaat1v9mnr31kuejckjr6pk2sy1m9wftnz',
    'cfxtest:achdcx8duddhped58v1x8rd46y6wr7bjce0jsnnjn7',
    'cfxtest:acbse6cfhz4vbx6v8g99jp7hcd0sexy36u4ratpy43',
    'cfxtest:ach2uhkbym2fdtmj0haz1g4e5nc51azr9y9w1eb5v4',
    'cfxtest:acf6gj3ertssxnz5v7sn0w4vnfuy61ceyaak8ahwvg',
    'cfxtest:acajnkxxk4v2sug3h82z1xhxs7m2a1efjp0waj5d33',
    'cfxtest:achs4b810z4gzv2344h8028c3fddxg3b4u4a8defcu',
    'cfxtest:acah40zmecn6gjmmcye16c7fh6pcpyfkfp4cngu55s',
    'cfxtest:acag6vyd3ycz0twvs2r74wc8pnvs4swsuen0vbk90w',
    'cfxtest:acfbkhurse0rxh3mz2v6fke7jee3bmmm5pg99jh3bm',
    'cfxtest:acg5wanrxkzyp74shezjbs0t6ax13x3xmpw8sbvuuv',
    'cfxtest:acadmbvh41xr35z20ajuy93h9hhgbc5a7pgtw8uc7f',
    'cfxtest:acg7juxc0u8g6h037zzjje8kegst92jbkua76jw9yc',
    'cfxtest:aca4484nejjtp8rupvbzfrt9c5z70fa956vv4r5v9r',
    'cfxtest:acgnzsg6akz548uusxahx7dxurbvfch8vyxeadfkac',
    'cfxtest:acatjw6ejdg1t4umpnhwstag6w7zrnbvf6m6wvnstm',
    'cfxtest:achrygt0at7ub1bty99um6f5g1mktdjw7ubt7gc40j',
    'cfxtest:acb3m4j5uwss7bfd97refj8m5zf9yd12gjghfcxws9',
    'cfxtest:acbxkd7g2uuaevuefnb63yzw6c9f44rehyaevj429z',
    'cfxtest:acddnt1fvwjw4gbgbyfcu52f0ek8fhwee64bd6mmgg',
    'cfxtest:acfnb32mb544vajfu6a133r5e08n9u2z5a4b6pxun5',
    'cfxtest:acfahcjjxcsjn7rn58ykf6dyu9k5cvtnk2apsz532g',
    'cfxtest:acevav9ad4pngn5ubzu5fctbbxuc35b1ue5v60m3vz',
    'cfxtest:acg76crzek5k3v39y2su78x3furnsc7b1pt2m3ruj5',
    'cfxtest:ach0agdy9ha3hgztbtmn1barhuwuryeg3ax17n1yu4',
    'cfxtest:acby2hxk08tfdu42pe1hn7x7vg7ywruywy1ga2hehw',
    'cfxtest:ach8z0z6ymhseumnv9t0b6y6zws2p607kyycpz23uv',
    'cfxtest:acb1t4spffag6n084pc5zmypky7nhkmphygmrwrdkh',
    'cfxtest:acfagzdw0t13bfyt98c7jcaj185m5vczcemwr8skcf',
    'cfxtest:acb27h9yju0wjv81mr6ntku4md80fhdx0azhahhznp',
    'cfxtest:acayzaxxu34gv7nr2u8upj52fbuyhbsf06e2n1rjtb',
    'cfxtest:acc7zgys3vva38r1b5whm9d5p7kjd46brar8nvc2vf',
    'cfxtest:acd3s7xt7arwx0mcg0j9evr28fjtk24hsjb3djnxrx',
    'cfxtest:aca8cd5y6kurt1r9st8gt52cuv9bj1u972mw8ws4c0',
    'cfxtest:acdgr2mdtamv1a3nfbhsknk4wff0gygj3ek6ddkrzc',
    'cfxtest:acdhembrtwvexfjbu34sgvsnrzfht2a2a6bdvzvu4p',
    'cfxtest:acerzmvyx1d6cjzmh0zjp7atxmeceed00j0frzddtg',
    'cfxtest:achs07c2awu20ph3k0aty68ya06yxdv256yvewnjz1',
    'cfxtest:acgb7u51f75aumyjpj5ac1abwr7r6pps22n0vj07sk',
    'cfxtest:acb8afkgu8nyu4n3w7nem2drpk2x5xj9mjwpv3yskh',
    'cfxtest:achsenax5kpzgnm9rtkvnyuye5ak5nnx1yx3wyzecd',
    'cfxtest:acem7avxsdnam340fz3sa11y2jx1kwgz3udnyx1njp',
    'cfxtest:acg2v76b89bvrbc6ph57bz2h7s0zn4a0w68kge5z10',
    'cfxtest:accvkes5hvmn8rub6uchwv1u5avdcgxb2ydn7x13mz',
    'cfxtest:accmtr41fmkh8en0ty0z8em7xjzk72rg2ua18cc01b',
    'cfxtest:acgdc31tj612b33w90erbhv8d15avpcw96bmknwrhn',
    'cfxtest:acawdr2fxgywdbtsjvbfp5z2m3x8yhh1kucw2eaetm',
    'cfxtest:acfs1mvw0srkj7nkmb2tma2btzwt5tgu8223nen8c8',
    'cfxtest:acbr2a31fruga38d4cedct0xvy6ympcnj2dt40b1vd',
    'cfxtest:acb47sf8b3pxh8nswbteeudr3sa05m1zjyvd9s90p2',
    'cfxtest:acdz1rtmcsnebft0u7kunrzfyywaww6n76j623tkgf',
    'cfxtest:acdv6fmwygk832703bt9vxrahm6xc2s2ae55cp2mpk',
    'cfxtest:aca1gs7chgjcnuhv8grf58zhfav2enk3z6p83db511',
    'cfxtest:acbrnwph2609zbf21np0501d87xb9dnvuakpv911xk',
    'cfxtest:acac9x3pucmfepw301pana01w6bs2bvg8yhfc0d8ew',
    'cfxtest:acf65xupx932gukxe16j6dyt7xmfm1yeb6r7msr58t',
    'cfxtest:acap2773242bea1fwajmy56my4f9em5twars33cw9f',
    'cfxtest:acdc4xzy0pg1dzrbajgmv8nw3cjyj6ezn2dzncc4w5',
    'cfxtest:acb9p3krvdtysg295xbch6wzkav6s28rzpb70e6ad5',
    'cfxtest:acf3hjfzd0pxgkua10afnmbk77g2wp54k2yf3tu2z3',
    'cfxtest:aca6w9t6dbgbwag65z4t1a2rp9yxsrnyj6vzgb6bv8',
    'cfxtest:acc1sc50mu9byg7217m3abu6fgwu6w8esetwssad3w',
    'cfxtest:ach30ubfutnue9g50r7mz2bj94gmj18pwjt5ccvbpd',
    'cfxtest:accd3ump7r82psmney9dwn8tbze773uukammrm5b7m',
    'cfxtest:acc4zyjwcpjkv6rwk405c8k565s13h9u0uzhhnskfn',
    'cfxtest:acb6fp2d40th1b1tp624c30zj6fzhh8tdp6ggwwrks',
    'cfxtest:acfpbwdbgtb05b325kc4he59143umjwb4a46ujgp9p',
    'cfxtest:acbdenmfrhm9bwew4uerkxku2yhfar8bx6nuj9jaky',
    'cfxtest:acgh3yn9tps16tspmbbr17vhww990fnjeahy077hm4',
    'cfxtest:acbv90mmr368us1jpmhaem0syuk1wgs3g6a0jnaaw6',
    'cfxtest:acfmz4skujkhntgpt8u8f4hnwg037twhdef61nzh86',
    'cfxtest:acc22gff9efkxhfbvx02w0bdnw27cte5zpwfycmna4',
    'cfxtest:acbxnumgfndd3tp217yf6krr7weecnd46yz6zby1tg',
    'cfxtest:aces7ns2fe8zwwkjdj1jrsm3sm3s1ejgzjucwda490',
    'cfxtest:acaeg7n3c9mhry0hchwkpebws23aahu22eceta4c19',
    'cfxtest:acb1h6z23upesyw749a9h62abyajy1hvry2089c63j',
    'cfxtest:acenrtz2hbr9ranfrbt4ugftfjma95cgvyvgmc0349',
    'cfxtest:acb63b02p2u0u6k1e7kx41fxyavt5y1rw606n9mmy1',
    'cfxtest:acgy1045e52gud13mk7syva3uzka6d8yxppx4pxj9r',
    'cfxtest:aceav1svm1cadm3087628c86v9gm3zf5167bb4dcpu',
    'cfxtest:aca2p5y57mcm1pcn0pgh4rw5x37nss2kza763raj1p',
    'cfxtest:acgpve58ebknw6u6ja238dr52bfx7712uycmrbna1s',
    'cfxtest:ach9pg0y14e0r9e1r4wpw7uc1zj5rb59n6swzwskvv',
    'cfxtest:acenjtygs5b76vpcp9mft8he8z4hwna1zag0zg053e',
    'cfxtest:achdu0p8wp0xgc2y62frm43e1bwx4h76he68wpwj21',
    'cfxtest:ach74wh4dyxvgvx5jvmxa8a8n5wfey4j62unv4a52h',
    'cfxtest:acbervudsfh4myb1kth1xnypygfznf2kj295unrxyp',
    'cfxtest:acbukspwazwjbw7je328nhtcjfa47k62eex4zbm86m',
    'cfxtest:acempxca36ms8ydwcn5rbxszf9d7smknepdwayjcru',
    'cfxtest:acht1437ff0ch32dems2vmtzg8c06dcb8ee7fhprye',
    'cfxtest:acd1w6wpm8uhwhjy0frn1s6kazhm0pmeces2a64m37',
    'cfxtest:acapaeubj5atkcuasj3u48dgp6mvtc5s0p3d9ja4av',
    'cfxtest:achymwn80reh23zhf1tr51pe8m9xh19166394f8kzu',
    'cfxtest:ach1j7t5c6vth05c2e769e780334tyy5aupm1tp20w',
    'cfxtest:acb2vd462vbk4sa2t2fdne6hgue07m5mk2662vuf4h',
    'cfxtest:acarxw0s85mh0d21gadknca30zbtru1ue600azve47',
    'cfxtest:acfd0g9a14x84fd93hufcgjn1rr0bekde24xsvr2ba',
    'cfxtest:acdmzjza69gauzn61t8vr4acsnuzg0gw0jga4zdsvn',
    'cfxtest:acegnyxjg9egtgu3byanatbhxes2778a2adu8weh0m',
    'cfxtest:acf19v8y4egt6528esryhd33dr6nj3jgk2vsxg62ba',
    'cfxtest:accxz3htc84jer1m2t3t6etrw1xm09b12ygkbz4mtp',
    'cfxtest:acaf7krnt1djb044g7r8f758mx5tn9387u46t721dp',
    'cfxtest:acbauyhgv90cpv6133yv3jvjhr6n6jwdwer2ugey36',
    'cfxtest:acg43uz86pxp3mmf2am2m5amxk1wvbr6d2zzsnhfca',
    'cfxtest:acaacj1sa4629vznh192ekj2bd3wmxyzk2ma6xkamn',
    'cfxtest:acdh3xzmrncpsunwz205ppcszcjzfjvsv66775hkrc',
    'cfxtest:acc1x87e7yb9ae6bu1znvg4us355jvbwjpwj93z51z',
    'cfxtest:acdv9vxh5cemca1e4j2m6r5e651brk5akj08er2drb',
    'cfxtest:acbg6mz5knhszrvraptscga70hty9yagdy6v09ed3h',
    'cfxtest:aceejzs4320upd74gszmxs48ey4dtbr07604k2kpga',
    'cfxtest:acb4azupj3nwje1pskp3c9ks9jn4k1zhmjb37ydt1d',
    'cfxtest:ace2javx7as9khaa94f51j60r9awza8fey8yyza0zz',
    'cfxtest:acgemu2d011wt1r0ky4hdrjbevcamjtyxjmz98z9rd',
    'cfxtest:acbpjrv07nu51n9gnx8y6je7816y4gr8d6xxvv7g4y',
    'cfxtest:acdf1g44dcr59c9a59dax554xr2zsagwtywuhgnbbb',
    'cfxtest:acg5x614ufaax6th6nnxtse4syajw6x9gutrfgvchc',
    'cfxtest:acd4f65fnn3jawu5yyj7jznt2f7fr2e3fanmrkkhm0',
    'cfxtest:accbat2rjukvug04vhcvuvz78mzftttfhesa059m5r',
    'cfxtest:accxfy7ad7srayyjna5msxh8g6s894es2e5dt2c7xe',
    'cfxtest:achd9ve2k4bz79nefvx4a9keun512hdff6psph7bb3',
    'cfxtest:acf4ph626bsjab8cz7pt831hhedpg5m5cp0krxrzpu',
    'cfxtest:achxx1kkyu5ft60kgk7ack62ff7gurbndpug8d5h68',
    'cfxtest:aceyj1y7cv41xg7px0ktb3tr1jmbcu8392mzm3j2rd',
    'cfxtest:acf9nu9w8xtwkrsrby158wdad14h89x2vytrdne1hg',
    'cfxtest:aca8kpy0u50g7zgyrg6yxexu0reerkg60a5b70097n',
    'cfxtest:aca3h33y2derxx1mb6zp8tdpafzypfhe5ukhrztmhv',
    'cfxtest:acd99rrn2jtjv477h8zj427e10kwvbemmy6dwzf9a7',
    'cfxtest:acgz5grumakpf8w9fajkppgegf7xc52zbprsnwharz',
    'cfxtest:acfuzmaxhgbp4dpytf34zj9yb9ht4rutaep1ucdjrp',
    'cfxtest:aca1t7n6rz7a3dcegm7rc5r15wmx4m4pxeav4b391c',
    'cfxtest:acgrzubv26afub35dpzaagv5gegwcneep631uwry9x',
    'cfxtest:acay6h499asg9gxy68f3ebha0pc5vrvyc6r3jpp40y',
    'cfxtest:acetexrevztdmzckws8n6y46en7h34z4typf0m283j',
    'cfxtest:acbu6eepr4xsvxmtufk1hexs9gzh4f59eju8r30a0b',
    'cfxtest:accs7ezgs7we788ss2y88xyatnm9w5cvxu59kezcst',
    'cfxtest:acb4ef7supraztync11spbkk4ys8851y0yer7pwubm',
    'cfxtest:acfnv27fb1k7yx8k7w26d9k9t0gme1sgvyhu8vm2bt',
    'cfxtest:acezeufzp7j1w0kf1tjpmp9tj106ywehbycuy972yf',
    'cfxtest:acad9nyk32rmcnfgat7ky7302s9hdsemn6vtxfnrwm',
    'cfxtest:achvpuybng9fvv781ztbt7cbmxx0k1ft225ywhcp3r',
    'cfxtest:acfb0rby45ep4p5wu1jex1f5vjhpccc60uw3wt3vj7',
    'cfxtest:ace1fnnhrs3p03279kf2djkp6df91w84mangbty5up',
    'cfxtest:achf0pdtc0cy6ngxry8hcbpagt1a5b9vspdu14dv9k',
    'cfxtest:acek0ng4gks8553gp0f09vb2mpwd5dsrsa569zbv75',
    'cfxtest:acgds8pw1cnc6tm986ppcujfuf7ek163zj730dzk0j',
    'cfxtest:ach4ufm1z98svn421jz4puzhm4cj07mam6y2e5g2sa',
    'cfxtest:acbttry22rsx7k54ms6hbkc0c8tf680u5pc0r31ef5',
    'cfxtest:acde0h4f9nz70h146d4p0wbbx38zamwhue3uce1ndt',
    'cfxtest:acg3dkm8kf5n2f8v1sfvyhn7kg5v7vy4vet94sb981',
    'cfxtest:achdthy401az6xguuf5032psehjghef58eck4d7mga',
    'cfxtest:ach7u62na0n2wh2eu45dkm0g5zbkvu9rnueaztfrjd',
    'cfxtest:acgzswg1c4bmb9xpnr6hf8m8yxbhcuz79jz9z56m1t',
    'cfxtest:aca57mzraujjp8791z1njryxptbfknwkcefexwsrwn',
    'cfxtest:acegzkuy14b8uwh1r061xsckpdwatzph06ve73yu38',
    'cfxtest:achdjphamez1d2036hc9755sf9dxx7zrv6ptx967zt',
    'cfxtest:acfj560vd7ytzxu7nrf6h9y9uwt35vhb821bje53j4',
    'cfxtest:acbw1yf2k2kdn2g8pd1vtpbejt63du58e64vamw368',
    'cfxtest:acdssrh5zxsd9g7m91u616ej6wb1d9zk4uujsduh37',
    'cfxtest:acfwckjj7y38rwt46s58k8dx845x848d96fv41acjz',
    'cfxtest:acbfc1dy9vj13v1dhrvmnmrzn653nm44cpj1y51db6',
    'cfxtest:accu86fpr3t6wnv8753w65gex6pvugz70jg3pp4912',
    'cfxtest:achecgb7abuccajunc5f7srfun4a2z8rh2s0yt4thm',
    'cfxtest:acey50m586egj8g9wcs49x6byeydwn14dj5s0c31c0',
    'cfxtest:acd7xax2feh3fbmf6mycu6f201zkrzv7cewtxt6b7v',
    'cfxtest:acapy4gp63rwmvhs0aw4hx6gz9jmt3u6mpfnytsy2h',
    'cfxtest:acam4xycmzg8umjb3xsr86m4bf95hdufg6ah5fdp64',
    'cfxtest:acgkzc8wcbr9nns2rxvdjs2aw6edw1j71uu66kkpt3',
    'cfxtest:acbupv02au44fkgc4k3hmv8wt1eppbp9dyjb160e4n',
    'cfxtest:acapc3y2j7atme3bawvaex18hs36tn40uu5h6j3mtu',
    'cfxtest:aca1858y5a9fnyx9rxd1c9knr517cd0e6afzzhgj01',
    'cfxtest:acc019bt53ysk4p7j935xhbfxsjf3vwgvyhnskpgcp',
    'cfxtest:ach8wp28s8nau9mpgeu911eg5fv3fjat0umz1a6ztg',
    'cfxtest:acgtxwup6mfhgjtsp07dtk2nvyjaw1wfjazxd502sx',
    'cfxtest:acdrt3zdbvc81vzmfh5feeerh3hsxhk5sjwr6wxj26',
    'cfxtest:achp7agfb826bkaxsras7f3n5z9ceu79uas3f1e8px',
    'cfxtest:acbxnujjb1e4ejdxmchzmhdajd17407uwym8u28x6y',
    'cfxtest:aca1yzrdzc4y4hgjhjh8tts9v4amsvest2apznukft',
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
        await parseVerified(base32);
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
    if(type === 13) {
        const updatedCursor = [
            1666942979000000,
            1667295779000000,
            1667295779000001,
            1667295779000002,
            1667295779000003,
            1667295779000004,
            1667295779000005,
            1667295779000006,
            1667295779000007,
            1667295779000008,
            1667295779000009,
            1667295779000010,
            1667295779000011,
            1667296241000000,
            1667296241000001,
            1667296241000002,
            1667296241000003,
            1667296241000004,
            1667296241000005,
            1667296457000000,
            1667296457000001,
            1667296457000002,
            1667296457000003,
            1667296457000004,
            1667296457000005,
            1667296457000006,
            1667296457000011,
            1667296457000012,
            1667296457000013,
            1667296457000014,
            1667296457000015,
            1667296457000016,
            1667296457000017,
            1667296457000018,
            1667379629000001,
            1667527343000000,
            1667527343000001,
            1667527343000002,
            1667527343000003,
            1667901321000000,
            1667901321000001,
            1667901321000002,
            1667901321000003,
            1667901321000004,
            1667901321000005,
            1667901321000006,
            1667901321000007,
            1667901321000008,
            1667901321000009,
            1667901321000010,
            1667901321000011,
            1667901321000012,
            1667901321000013,
            1667901766000000,
            1667901766000001,
            1667901766000002,
            1667901766000003,
            1667901766000004,
            1667901766000005,
            1667902464000000,
            1667902464000001,
            1667902464000002,
            1667902464000003,
            1667902464000004,
            1667902464000005,
            1667902464000006,
            1667902464000007,
            1667902464000008,
            1667902464000009,
            1667902464000010,
            1667902464000011,
            1667902464000012,
            1667902574000000,
            1667902574000001,
            1667902574000002,
            1667902574000003,
            1667902574000004,
            1667902574000005,
            1667902574000006,
            1667902574000007,
            1667902574000008,
            1667902574000009,
            1667902574000010,
            1667902588000000,
            1667902588000001,
            1667902588000002,
            1667902588000003,
            1667902588000004,
            1667902588000005,
            1667902588000006,
            1667902588000007,
            1667902588000008,
            1667902588000009,
            1667902588000010,
            1667902588000011,
            1667902588000012,
            1667902913000000,
            1667902913000001,
            1667902913000002,
            1667902913000003,
            1667902913000004,
            1667902913000005,
            1667902913000006,
            1667902913000007,
            1667902913000008,
            1667902913000009,
            1667902913000010,
            1667902913000011,
            1667903199000000,
            1667903199000001,
            1667903199000002,
            1667903199000003,
            1667903199000004,
            1667903199000005,
            1667903199000006,
            1667903199000007,
            1667903199000008,
            1667903199000009,
            1667903199000010,
            1667903199000011,
            1667903199000012,
            1667903199000013,
            1667903453000000,
            1667903453000001,
            1667903453000002,
            1667903453000003,
            1667903453000004,
            1667903453000005,
            1667903453000006,
            1667903453000007,
            1667903453000008,
            1667903453000009,
            1667903453000010,
            1667903453000011,
            1667903453000012,
            1667903453000013,
            1667903466000000,
            1667903466000001,
            1667903466000002,
            1667903466000003,
            1667903466000004,
            1667903466000005,
            1667903466000006,
            1667903638000000,
            1667903638000001,
            1667903638000002,
            1667903638000003,
            1667903638000004,
            1667903638000005,
            1667903638000006,
            1667903638000007,
            1667903638000008,
            1667903638000009,
            1667903638000010,
            1667903638000011,
            1667903638000012,
            1667903740000000,
            1667903740000001,
            1667903740000002,
            1667903740000003,
            1667903740000004,
            1667903740000005,
            1667903740000006,
            1667903909000002,
            1667903909000003,
            1667903909000004,
            1667903909000005,
            1667903909000006,
            1667903909000007,
            1667903909000008,
            1667903909000009,
            1667903909000010,
            1667903909000011,
            1667903909000012,
            1667903909000013,
            1667903909000014,
            1667903909000015,
            1667903909000016,
            1667903909000017,
            1667903909000018,
            1667904545000000,
            1667904545000001,
            1667904545000002,
            1667904545000003,
            1667904545000004,
            1667904545000005,
            1667904545000006,
            1667904545000007,
            1667904545000008,
            1667904545000009,
            1667904545000010,
            1667904545000011,
            1667904545000012,
            1667904545000013,
            1667957565000000,
            1667957588000000,
            1667957588000001,
            1667957588000002,
            1667957600000000,
            1667957600000001,
            1667957600000002,
            1667957600000003,
            1667958199000000,
            1667958199000001,
            1667958199000002,
            1667958199000003,
            1667958243000000,
            1667958243000001,
            1667958243000002,
            1667958243000003,
            1667958243000004,
            1667958579000000,
            1667958579000001,
            1667958579000002,
            1667958579000003,
            1667958579000004,
            1667958596000000,
            1667958596000001,
            1667958596000002,
            1667958610000000,
            1667958610000001,
            1667958610000002,
            1667958610000003,
            1667958619000000,
            1667958619000001,
            1667959174000000,
            1667959174000001,
            1667959174000002,
            1667959174000003,
            1667959196000000,
            1667959196000001,
            1667959711000000,
            1667959711000001,
            1667959711000002,
            1667959711000003,
            1667959711000004,
            1667959764000000,
            1667959764000001,
            1667959764000002,
            1667960503000000,
            1667960503000001,
            1667960503000002,
            1667960503000003,
            1667960517000000,
            1667960517000001,
            1667960517000002,
            1667960517000003,
            1667960517000004,
            1667960548000000,
            1667960548000001,
            1667960557000000,
            1667960557000001,
            1667960557000002,
            1667960557000003,
            1667960557000004,
            1667960575000000,
            1667960831000000,
            1667960831000001,
            1667960831000002,
            1667960862000000,
            1667960862000001,
            1667960862000002,
            1667960862000003,
            1667960868000000,
            1667960868000001,
            1667960868000002,
            1668008328000000,
            1668009011000000,
            1668009011000001,
            1669725479000000,
            1669725479000001,
            1669725479000002,
            1672753338000003,
            1672753350000000,
            1672753350000001,
            1672753350000002,
            1672753350000003,
            1672753370000000,
            1672753370000001,
            1672753370000002,
            1672753370000003,
            1672753643000000,
            1672753643000001,
            1672886744000000,
            1672886956000000,
            1672886956000001,
            1673081405000000,
            1673081405000001,
            1673081405000002,
            1673090450000000,
            1673090450000001,
            1673090462000000,
            1673090462000001,
            1673090596000000,
            1673090596000001,
            1673090605000000,
            1673090605000001,
            1673090605000002,
            1673090605000003,
            1673090791000000,
            1673090791000001,
            1673090791000002,
            1673090791000003,
            1673090796000000,
            1673090796000001,
            1673090796000002,
            1673190339000000,
            1673191963000000,
            1673191963000001,
            1673191970000000,
            1673191970000001,
            1673191970000002,
            1673191970000003,
            1673336082000000,
            1673336082000001,
            1673336082000002,
            1673361998000000,
            1673361998000001,
            1673361998000002,
            1673361998000003,
            1673361998000004,
            1673361998000005,
            1673362130000000,
            1673362130000001,
            1673362130000002,
            1673362143000000,
            1673362143000001,
            1673362167000000,
            1673362167000001,
            1673362167000002,
            1673362167000003,
            1673362449000000,
            1673362449000001,
            1673362563000000,
            1673362563000001,
            1673362584000000,
            1673362986000000,
            1673362986000001,
            1673363003000000,
            1673363003000001,
            1673363003000002,
            1673363520000000,
            1673363520000001,
        ];
        await fixRepeatedUpdatedCursor(updatedCursor);
    }
}
const args = process.argv.slice(2)
StatApp.networkId = Number(args[0]);
type = Number(args[1]);
if(type === 6) {
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
run().then();
