import {redirectLog} from "../../config/LoggerConfig";
const lodash = require('lodash');
// @ts-ignore
import {Conflux, Contract, format} from "js-conflux-sdk";
import {abi} from "./contract/BatchBalanceOf";
import {CfxWatcher} from "./BalanceWatcher";
import {buildHexSet, hex40IdMap, Hex40Map, idHex40Map, makeId, makeIdV} from "../../model/HexMap";
import {StatApp} from "../../StatApp";
import {BALANCE_UTIL_ABI} from "./contract/BalanceUtilAbi";
import {Sequelize, Op,fn, col, QueryTypes} from 'sequelize'
import {KEY_1155data_EPOCH, KEY_NFT_FROM_MINT_TABLE, KV, SCAN_UTIL_CONTRACT} from "../../model/KV";
import {TokenTool} from "../tool/TokenTool";
import {Erc1155Data, NftMint, Token} from "../../model/Token";
import {handleTokenTransferWithContract, scheduleTransferUpdater, updateTokenTransferCount} from "../../StreamSync";
import {ContractUser} from "../../model/Erc20Transfer";
import {createConflux, patchHttpProvider} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {regExitHook, sleep} from "../tool/ProcessTool";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {TokenBalance} from "../../model/Balance";
import {abi1155, CONFIRM_GAP, destroyedContracts, fetch1155balance, fix1155data, rewind} from "./Erc1155DataSync";
import {initNftMetaWorkerContext, startMetaWorker} from "../nftchecker/NftMetaStorage";

export const batchContractAddress = '0x8f35930629fce5b5cf4cd762e71006045bfeb24d'
const MAINNET_UTIL_CONTRACT = 'cfx:acef1ym9m16fc94x29h0800k0ugnaj91sjjbm60hfh'
const TESTNET_UTIL_CONTRACT = 'cfxtest:achamkxtk3yn534h483vdvv0kcffwr221uyw9xnucr'

export class BatchBalanceWatcher {
    private cfx: Conflux;
    public static contract: {balances};
    public static allTokenContract: {getBalances};
    private readonly tokenList: string[];
    fraction = BigInt(1e+18)
    private readonly cfxWatcher:CfxWatcher
    constructor( cfx:Conflux, cfxWatcher:CfxWatcher, utilContract: string | null) {
        if (!utilContract) {
            console.log(` scan util contract should be an address. Got [${utilContract}]`)
            process.exit(9)
        }
        this.cfx = cfx;
        this.cfxWatcher = cfxWatcher;
        // @ts-ignore
        BatchBalanceWatcher.contract = cfx.Contract({abi, address: format.address(batchContractAddress, StatApp.networkId)})
        // @ts-ignore
        BatchBalanceWatcher.allTokenContract = cfx.Contract({abi: BALANCE_UTIL_ABI, address: utilContract})
    }

    public static async getUtilContractAddr() {
        // use config in DB ?
        const utilContract = StatApp.networkId === 1 ? TESTNET_UTIL_CONTRACT :
            StatApp.networkId === 1029 ? MAINNET_UTIL_CONTRACT : (await KV.getString(SCAN_UTIL_CONTRACT, ''))
        return utilContract;
    }
    logCount = 300

    public static async getBalances(account:string, tokens:string[]) {
        let banList = await BatchBalanceWatcher.allTokenContract.getBalances(account, tokens).catch(err=>{
            console.log(` getBalances fail: `, err.data)
            console.log(` getBalances fail: `, err)
        })
        return banList
    }
}
// ---
async function fixAllNftHolder(byMintTable:boolean, type: string) {
    const tokenList = await Token.findAll({attributes:['id','hex40id','type',],where: {type}})
    console.log(`1155 count ${tokenList.length}`)
    for (let i = 0; i < tokenList.length; i++) {
        await fixHolderForContract(tokenList[i].hex40id, byMintTable)
    }
}
async function fixHolderForContract(contractId: number, byMintTable:boolean) {
    const holderList = byMintTable ?
        await NftMint.findAll({
            attributes: [
                ['toId', 'addressId'],
                [fn('count', col('*')), 'cnt'],
            ],
            where: {contractId,}, raw: true, group: 'addressId', logging: console.log
        })
        :
        await Erc1155Data.findAll({
        attributes: [
            'addressId',
            [fn('count', col('*')), 'cnt'],
        ],
        where: {contractId,}, raw: true, group: 'addressId', logging: console.log
    })
    const map = new Map<number, any>()
    holderList.forEach(row=>map.set(row.addressId, row))

    const balanceList = await TokenBalance.findAll({where: {contractId}})
    console.log(`${contractId} exists ${balanceList.length}, calculate ${holderList.length}`)
    for (let i = 0; i < balanceList.length; i++) {
        const bean = balanceList[i]
        const newRow = map.get(bean.addressId)
        if (!newRow) {
            await TokenBalance.destroy({where: {contractId, addressId:bean.addressId}})
            console.log(`${contractId} destroy ${bean.addressId}`)
        } else if (bean.balance.toString() != newRow['cnt'].toString()) {
            await TokenBalance.update({balance: newRow['cnt']},
                {where: {contractId, addressId:bean.addressId}})
            console.log(`${contractId} update ${bean.addressId} ${newRow['cnt']}`)
        }
        map.delete(bean.addressId)
    }
    for(let row of map.values()) {
        await TokenBalance.create({contractId, addressId: row.addressId, balance: row['cnt']})
        console.log(`${contractId} create ${row.addressId} ${row['cnt']}`)
    }
    await Token.update({holder: holderList.length}, {where: {hex40id: contractId}})
    console.log(`${contractId} finished`)
}
// ---
let latestEpoch = BigInt(0)
async function syncErc1155data(epochBase: number, rpc: Contract, cfx:Conflux) {
    const mark = await Erc1155Transfer.min('epoch', {
        where: {epoch: {[Op.gt]: epochBase}},
    })
    if (!mark || isNaN(Number(mark))) {
        return 0
    }
    let isNewLatestEpoch = false;
    if (latestEpoch - BigInt(mark) < CONFIRM_GAP) {
        do {
            // make sure latest epoch is greater than previous epoch  mark. so the UPDATE could affect record.
            const newLatestEpoch = await cfx.getEpochNumber('latest_state').then(res=>BigInt(res))
            if (newLatestEpoch < Number(mark)) {
                console.log(` rpc epoch should > ${Number(mark)}. got ${newLatestEpoch}`)
                await sleep(5_000)
            } else if (newLatestEpoch > latestEpoch) {
                console.log(` set latestEpoch to`, newLatestEpoch)
                latestEpoch = newLatestEpoch
                isNewLatestEpoch = true
                break;
            } else {
                console.log(` wait latest epoch growing. current ${latestEpoch}`)
                await sleep(5_000)
            }
        } while (true)
    }
    // compare with exists hold records. When reOrg, some Transfer may disappear.
    const holderList = await Erc1155Data.findAll({where: {epoch: mark}})
    const holderMap = new Map<string, Erc1155Data>()
    holderList.forEach(h=>holderMap.set(`${h.contractId}_${h.addressId}_${h.tokenId}`, h))

    const transferList = await Erc1155Transfer.findAll({
        where: {epoch: mark}
    })
    console.log(` transfer 1155 count ${transferList.length}, exists count ${holderList.length} epoch ${mark}`)
    if (transferList.length == 0) {
        return 0
    }
    const addressIds = buildHexSet(undefined, transferList, 'fromId', 'toId', 'contractId');
    const addressMap = await idHex40Map([...addressIds])
    const contracts = new Map<number, {accounts:string[], tokenIds: BigInt[], addrIds: any[]}>()
    // build params before call contract
    const contractAddrTokenSet = new Set<string>()
    for (let trans of transferList) {
        let params = contracts.get(trans.contractId)
        if (!params) {
            params = {accounts: [], tokenIds: [], addrIds: []}
            contracts.set(trans.contractId, params)
        }
        // from
        const hexFrom = `0x${addressMap.get(trans.fromId)}`;
        const duplicateKey1 = `${trans.contractId}_${trans.fromId}_${trans.tokenId}`
        if (trans.fromId != zeroAddrId && !contractAddrTokenSet.has(duplicateKey1)) {
            contractAddrTokenSet.add(duplicateKey1)
            holderMap.delete(duplicateKey1)
            params.accounts.push(hexFrom)
            params.tokenIds.push(BigInt(trans.tokenId))
            params.addrIds.push(trans.fromId)
        }
        // to
        const duplicateKey2 = `${trans.contractId}_${trans.toId}_${trans.tokenId}`
        const hexTo = `0x${addressMap.get(trans.toId)}`;
        if (trans.toId != zeroAddrId && !contractAddrTokenSet.has(duplicateKey2)) {
            contractAddrTokenSet.add(duplicateKey2)
            holderMap.delete(duplicateKey2)
            params.accounts.push(hexTo)
            params.tokenIds.push(BigInt(trans.tokenId))
            params.addrIds.push(trans.toId)
        }
    }
    // call contract, save to db
    for (let contractId of contracts.keys()) {
        const params = contracts.get(contractId)
        rpc.address = '0x'+addressMap.get(contractId)
        if (destroyedContracts.has(rpc.address)) {
            continue
        }
        let balanceArr = await fetch1155balance(rpc, cfx, params);

        let idx = -1
        for (const b of balanceArr) {
            idx ++
            const tokenId = params.tokenIds[idx].toString()
            const addressId = params.addrIds[idx]
            if (b) {
                // at least the epoch is different.
                const [affected] = await Erc1155Data.update({amount: b, epoch: Number(mark), latestEpoch}, {
                    where: {contractId, addressId, tokenId}, logging: isNewLatestEpoch ? console.log : false
                })
                if (!affected) {
                    // check existence
                    const some = await Erc1155Data.findOne({where: {contractId, addressId, tokenId}})
                    if (some) {
                        console.log(`exists contract ${contractId} addressId ${addressId} tokenId ${tokenId}`)
                        continue
                    }
                    //
                    await Erc1155Data.create({
                        contractId, addressId, tokenId, amount: b, epoch: Number(mark), latestEpoch
                    }, {logging: isNewLatestEpoch ? console.log : false})
                    const tokenBalance = await TokenBalance.findOne({
                        where: {contractId, addressId}
                    })
                    if (tokenBalance) {
                        await TokenBalance.increment('balance', {
                            where: {contractId, addressId}, by: 1
                            , logging: isNewLatestEpoch ? console.log : false
                        });
                        console.log(` increase balance , contractId, addressId` , contractId, addressId)
                    } else {
                        console.log(` CREATE balance , contractId, addressId` , contractId, addressId)
                        await TokenBalance.create({contractId, addressId, balance: BigInt(1)},{
                            logging: isNewLatestEpoch ? console.log : false
                        })
                    }
                }
            } else {
                const deleted = await Erc1155Data.destroy({
                    where: {contractId, addressId, tokenId}
                })
                console.log(` --- DELETE erc1155 data affect ${deleted}, contractId, addressId, tokenId`, contractId, addressId, tokenId)
                if (deleted) {
                    // decrease balance after destroy one token_hold record
                    await TokenBalance.increment('balance', {
                        where: {contractId, addressId}, by: -1, logging: isNewLatestEpoch ? console.log : false
                    });
                    // delete if balance < 1
                    const delBalance = await TokenBalance.destroy({where: {contractId, addressId, balance: {[Op.lt]: 1}}})
                    console.log(` --- DELETE TokenBalance, affected ${delBalance}`)
                }
            }
        }
    }
    if (holderMap.size > 0) {
        console.log(` ----- rare case, hold disappear epoch ${mark}, length ${holderMap.size}---`)
        for (let value of holderMap.values()) {
            console.log(`destroy ${JSON.stringify(value)}`)
            await value.destroy({logging: console.log})
        }
    }
    return mark;
}
async function setupSync1155data(cfx:Conflux) {
    let lastEpoch = await KV.getNumber(KEY_1155data_EPOCH, -2)
    if (lastEpoch == -2) {
        await KV.saveNumber(KEY_1155data_EPOCH, -1, undefined)
        console.log(`create position`, -1)
    } else {
        console.log(`exists position`, lastEpoch)
        await rewind()
    }
    //

    const contract = cfx.Contract({abi: abi1155})
    return contract
}
let contract1155: Contract = null;
async function repeatSync1155data(cfx:Conflux) {
    if (!contract1155) {
        contract1155 = await setupSync1155data(cfx)
    }
    let lastEpoch = await KV.getNumber(KEY_1155data_EPOCH, -1)
    const thatEpoch = await syncErc1155data(lastEpoch, contract1155, cfx).catch(err=>{
        console.log(`syncErc1155data fail , lastEpoch ${lastEpoch}`, err)
        return -1
    })
    if (thatEpoch === -1) {
        setTimeout(()=>repeatSync1155data(cfx), 5_000)
    } else if (thatEpoch) {
        await KV.saveNumber(KEY_1155data_EPOCH, BigInt(thatEpoch), undefined)
        if (Number(thatEpoch) % 100 == 0) {
            console.log(` sync Erc1155 data at epoch ${thatEpoch}`)
        }
        setTimeout(()=>repeatSync1155data(cfx), 0)
    } else {
        console.log(` no Erc1155 data after epoch ${lastEpoch}`)
        // rewind cursor, to check records within then CONFIRM_GAP
        await rewind()
        setTimeout(()=>repeatSync1155data(cfx), 5_000)
    }
}
async function update20holder(hex40id:number, cfx:Conflux, name='') {
    const holderList = await TokenBalance.findAll({
        attributes: ['addressId'],
        where: {contractId: hex40id}
    })
    console.log(`contract id ${hex40id} name [${name}], holder count ${holderList.length}`)
    const chunks2d: any[][] = lodash.chunk(holderList, 10);
    for(const chunk of chunks2d) {
        const map = new Map<number, Set<number>>()
        map.set(hex40id, new Set<number>(chunk.map(h=>h.addressId)))
        await handleTokenTransferWithContract(map, cfx)
        map.clear()
    }
}
async function fix20holder(cfx:Conflux) {
    const [,,_,contractId] = process.argv
    await cfx.updateNetworkId();
    const {networkId} = await cfx.getStatus()
    StatApp.networkId = networkId
    new BatchBalanceWatcher(cfx, null, await BatchBalanceWatcher.getUtilContractAddr())
    if (contractId === 'all') {
        const list = await Token.findAll({attributes: ['hex40id', 'symbol', 'base32'],
            where: {type: 'ERC20', auditResult: true}})
        for(const token of list) {
            await update20holder(token.hex40id, cfx, token.symbol)
        }
    } else {
        await update20holder(parseInt(contractId), cfx)
    }
    console.log(`done`)
    process.exit(0)
}
// ---
let zeroAddrId = 0
async function run() {
    const [, script,cfxUrl,limitStr, opt] = process.argv;
    console.log(`${script} ${cfxUrl} ${limitStr}`)
    const cfg = await init();
    if (cfxUrl === 'fixNftHolder') {
        let byMintTable// = opt === 'byMintTable'
        const contractId = limitStr
        const token = await Token.findOne({where: {hex40id: contractId}, attributes: {exclude: ['icon']}})
        if (!token || !token.type) {
            console.log(`bad token [${contractId}]`, token)
            process.exit(0)
            return;
        }
        if (token.type.includes('721')) {
            // console.log(`Must use <byMintTable> for 721 token`)
            // process.exit(0)
            byMintTable = true;
        } else if (token.type.includes('1155')) {
            byMintTable = false;
        } else {
            console.log(`bad token type`, token)
            process.exit(0)
            return;
        }
        await fixHolderForContract(parseInt(limitStr), byMintTable)
        process.exit(0)
        return
    } else if (cfxUrl === 'fixAll721holder') {
        // check721OwnerInDb in TokenTool.ts
        await fixAllNftHolder(true, 'ERC721')
        process.exit(0)
        return
    } else if (cfxUrl === 'fixAll1155holder') {
        const byMintTable = false//opt === 'byMintTable'
        await fixAllNftHolder(byMintTable, 'ERC1155')
        process.exit(0)
        return
    } else if (cfxUrl === 'fix1155data') {
        await fix1155data(createConflux(cfg.conflux));
        return;
    } else if (cfxUrl === 'fix20holder') {
        await fix20holder(createConflux(cfg.conflux))
        return
    }
    redirectLog()
    regExitHook()
    const url = cfxUrl === 'useConfigRpc' ? cfg.conflux.url : cfxUrl
    const cfx = new Conflux({url});
    patchHttpProvider(cfx, {url})
    await cfx.updateNetworkId();
    const zeroHex = '0x'+'0'.padStart(40, '0')
    zeroAddrId = await makeIdV(zeroHex)
    if (limitStr === 'repeatSync1155data') {
        await repeatSync1155data(cfx)
        return
    }
    const st = await cfx.getStatus()
    StatApp.networkId = st.networkId;
    const utilContract = await BatchBalanceWatcher.getUtilContractAddr();
    new BatchBalanceWatcher(cfx, null, utilContract)
    console.log(`------------- network ${st.networkId} ------ utilContract ${utilContract}------`)
    console.log(`---- latestState ${st.latestState} latestConfirmed ${st.latestConfirmed}`)
    scheduleTransferUpdater();
    const useLegacyNftMint = await KV.getSwitch(KEY_NFT_FROM_MINT_TABLE)
    if (!useLegacyNftMint) {
        repeatSync1155data(cfx).then()
    }
    initNftMetaWorkerContext(cfx, "useDbGateway");
    startMetaWorker("latest_mint").then();
    const limit = limitStr ? parseInt(limitStr) : 10_000
    async function repeat() {
        let cnt: number = 0;
        try {
            cnt = await processContractUser(cfx, limit);
        } catch (e) {
            console.log(`processContractUser error.`, e)
        }
        if (cnt === 0) {
            await sleep(5_000);
        }
        setTimeout(repeat, 0);
    }
    repeat().then()
}
// should check rpc epoch, and only delete confirmed records.
// in case the sync process uses a rpc with higher epoch than this program.
async function processContractUser(cfx:Conflux, limit:number) {
    const list = await ContractUser.findAll({
        order: [['id', 'asc']], limit
    })
    if (list.length === 0) {
        console.log(` ${new Date().toISOString()} empty contract user table .`)
        return 0;
    }
    // const maxDbId = await ContractUser.findOne({order:[['id','desc']]}).then(res=>res.id)
    const [{id:minId}] = list;
    const maxId = list[list.length - 1].id
    // if (maxDbId - maxId < 10) {
    // }
    const ms = Date.now();
    console.log(`${new Date().toISOString()} process ${minId}, ${maxId}, count ${list.length} begin.`)
    try {
        await addTransferInfo(list, cfx);
    } catch (e) {
        console.log(` process fail . `, e)
        return 0;
    }
    const confirmedEpoch = await cfx.getEpochNumber('latest_confirmed');
    const delCnt = await ContractUser.destroy({where: {
        id: {[Op.in]:list.map(u=>u.id)}, epoch: {[Op.lte]: confirmedEpoch}
    }});
    const hasUnconfirmed = list.find(r=>r.epoch>confirmedEpoch);
    if (hasUnconfirmed) {
        console.log(`hasUnconfirmed, wait a moment`)
        await sleep(5_000)
    }
    const elapse = Date.now() - ms;
    const avg = (elapse / list.length).toPrecision(5)
    console.log(`${new Date().toISOString()} process contract user, count ${list.length
    },  deleted ${delCnt}, [${minId},${maxId}], avg ${avg}ms.`)
}
let tokenTool:TokenTool
// update total supply and holder balance.
export async function addTransferInfo(arr:{fromId:number, toId:number, contractId:number}[], cfx:Conflux) {
    const transferInfoMap = new Map<number, Set<number>>()
    arr.forEach(item=>{
        let adSet = transferInfoMap.get(item.contractId)
        if (!adSet) {
            adSet = new Set<number>()
            transferInfoMap.set(item.contractId, adSet)
        }
        item.fromId !== zeroAddrId && adSet.add(item.fromId)
        item.toId !== zeroAddrId && adSet.add(item.toId)
    });
    const map = transferInfoMap;
    await updateTotalSupply(cfx, [...map.keys()])
    console.log(` ---`)
    await handleTokenTransferWithContract(map, cfx)
    console.log(` ---`)
    await updateTokenTransferCount(map.keys(), false)
}
async function updateTotalSupply(cfx:Conflux, contractIds:number[]) {
    if (!tokenTool) {
        tokenTool = new TokenTool(cfx)
    }
    for (let i = 0; i < contractIds.length; i++) {
        let cid = contractIds[i];
        let hexBean: Hex40Map;
        try {
            hexBean = await Hex40Map.findByPk(cid);
            let sup = await tokenTool.getTokenTotalSupply('0x'+hexBean.hex)
            if (!sup) {
                sup = await NftMint.count({where: {contractId: cid}})
                console.log(` updateTotalSupply, nft count for 0x${hexBean.hex} id ${cid} is ${sup}`)
                if (!sup) {
                    continue;
                }
            }
            const [cnt] = await Token.update({totalSupply: sup}, {
                where: {hex40id: cid},
                // logging: console.log,
            });
            console.log(` update total supply affect ${cnt}, sup ${sup} cid ${cid} hex 0x${hexBean.hex}`)
        } catch (e) {
            console.log(`update token total supply fail, 0x${hexBean.hex}:`, e)
        }
    }
}

if (require.main === module) {
    run().then()
}