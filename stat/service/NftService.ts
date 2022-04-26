import {Sequelize, Op} from 'sequelize'
import {Erc721Transfer} from "../model/Erc721Transfer";
import {
    buildHexSet,
    convert2base32map,
    getAddrId,
    hex40IdMap,
    Hex40Map,
    idHex40Map,
    makeIdV,
    mapProp
} from "../model/HexMap";
import {Erc1155Data, NftMint, Token} from "../model/Token";
import {Erc1155Transfer} from "../model/Erc1155Transfer";
import {init} from "./tool/FixDailyTokenStat";
import {format} from "js-conflux-sdk";
import {list2map, reverseMap} from "./common/utils";
import {StatApp} from "../StatApp";
const lodash = require('lodash');
import {KEY_NFT_FROM_DB, KEY_NFT_FROM_MINT_TABLE, KV} from "../model/KV";

export class NftService {
    zeroAddrId:number

    async setup() {
        const hex = '0'.padStart(40, '0')
        this.zeroAddrId = await makeIdV(hex)
        console.log(`setup zero addr id to ${this.zeroAddrId}`)
        KV.findByPk(KEY_NFT_FROM_DB).then(res=>{
            if(!res) {
                KV.create({key: KEY_NFT_FROM_DB, value: '1'})
            }
        })
    }

    // sync from exists transfer record from DB
    async checkByEpoch(from, range, model) : Promise<Erc721Transfer[]> {
        return model.findAll({where:{fromId: this.zeroAddrId, epoch:{[Op.between]:[from, from+range]}}})
    }
    async saveIds(list:any/*Erc721Transfer*/[]) {
        const beans:any[] = list.map(t=>{
            const b = {contractId: t.contractId, createdAt: t.createdAt,
                toId: t.toId, tokenId: t.tokenId, txHashId: t.txHashId,
                updatedAt: t.createdAt,
            }
            return b
        })
        return NftMint.bulkCreate(beans,{
            updateOnDuplicate:["updatedAt","toId","epoch","blockIndex","txIndex"],
            logging: false
        })
    }
    async checkAll(from) {
        await this.setup()
        const stop = Math.max(
            await Erc721Transfer.max('epoch'),
            await Erc1155Transfer.max('epoch'))
        const batch = 1000
        while(from <= stop) {
            let count = 0
            const result = await this.checkByEpoch(from, batch-1, Erc721Transfer).then(list=>{
                count += list.length
                return this.saveIds(list)
            }).then(()=>{
                return this.checkByEpoch(from, batch-1, Erc1155Transfer)
            }).then(list=>{
                count += list.length
                return this.saveIds(list)
            }).catch(err=>{
                console.log(`error at [${from},${from+batch-1}]`, err)
                return -1
            })
            if (result === -1) {
                break;
            }
            from += batch
            process.stdout.write(`\r\u001b[2K fixed count ${count}, to epoch ${from+batch-1}, will stop at ${stop}   $`)
        }
        console.log(`\n done ${from}, stop ${stop}`)
    }
}

export async function getRegisterNftBalances(accountBase32: string) {
    const accHexId = await getAddrId(format.hexAddress(accountBase32))
    const nftTokenList = await Token.findAll({
        attributes:['base32','hex40id', 'name'],
        where:{type: {[Op.in]:['ERC721', 'ERC1155']}, auditResult: true},
        raw: true,
    })

    if (nftTokenList.length === 0 || accHexId === null) {
        return [];
    }

    const contractHexIds = nftTokenList.map(t=>t.hex40id);
    const balanceList = await countAccountNft(contractHexIds, accHexId)
    const tokenMap = list2map(nftTokenList, 'hex40id')

    const balanceInfoObject = {};
    balanceList.forEach(bean=>{
        const token = tokenMap.get(bean.contractId);
        if (token) {
            balanceInfoObject[token.base32] = {
                address: token.base32,
                balance: `${bean["balance"]}`,
                type: token.name,
                name: {zh: token.name, en: token.name}
            };
        }
    })
    return Object.values(balanceInfoObject);
}

async function countAccountNft(cHexIds: number[], accHexId: number) {
    const groupByContractList = await NftMint.findAll({
        attributes: [
            'contractId',
            [Sequelize.fn('COUNT', Sequelize.col('*')), 'balance'],
        ],
        where: {
            // contractId: {[Op.in]: cHexIds}, // do not filter in DB, filter in memory
            toId: accHexId
        },
        group: ["contractId"], raw: true,
        // logging: console.log,
    })
    const set = new Set(cHexIds)
    return groupByContractList.filter(r=>set.has(r.contractId));
}
export async function listNftOfAccountByContract(accountBase32:string, contractBase32:string, skip:number, limit:number)
    : Promise<{count: number, list:{tokenId:string}[]}>{
    const [accHexId,contractId, fromMintTable] = await Promise.all([
        getAddrId(format.hexAddress(accountBase32)),
        new Promise(resolve => {
            if (contractBase32) {
                getAddrId(format.hexAddress(contractBase32)).then(resolve)
            }else {
                resolve(false)
            }
        }),
        KV.getSwitch(KEY_NFT_FROM_MINT_TABLE)
    ])
    const where = {toId: accHexId};
    if (contractId) {
        where['contractId'] = contractId
        if (!fromMintTable) { // from erc1155 data table.
            const token1155 = await Token.findOne({
                where: {hex40id: contractId, type: 'ERC1155'},
                attributes: ['type', 'base32']
            })
            if (token1155) {
                const page = await Erc1155Data.findAndCountAll({
                    where: {contractId, addressId: accHexId}, raw: true,
                    order:[['epoch','desc']], offset: skip, limit,
                })
                const {rows: list, count} = page;
                list.forEach(row => row['contractBase32'] = token1155.base32)
                return {count, list}
            }
        }
    }
    const list = await NftMint.findAll({
        where: where, offset:skip, limit, raw: true,
        order: [['updatedAt','DESC']]
    })
    const hexIdSet = buildHexSet(undefined, list,
        'contractId')
    const map = await idHex40Map([...hexIdSet])
    const base32map = convert2base32map(map)
    mapProp(base32map, list, 'contractId', 'contractBase32')
    const count = await NftMint.count({where})
    return {count, list};
}
// query with specified contracts
export async function getNftBalances(accountBase32:string, contractsBase32:string[]) {
    const accHexId = await getAddrId(accountBase32)
    if (accHexId === null) {
        return contractsBase32.map(b=>0) // zero array.
    }
    const cHexArr = contractsBase32.map(base32=>format.hexAddress(base32));
    const hex2idMap = await hex40IdMap(cHexArr);
    const cHexIds = [...hex2idMap.values()]
    if (cHexIds.length === 0) {
        return contractsBase32.map(b=>0) // zero array.
    }
    // console.log(`acc id ${accHexId}, contracts [${cHexIds}]`)
    const groupByContractList = await countAccountNft(cHexIds, accHexId);
    const id2hexMap = reverseMap(hex2idMap)
    // fix base32
    groupByContractList.forEach(bean=>{
        bean['contractBase32'] = format.address('0x'+id2hexMap.get(bean.contractId), StatApp.networkId)
    })
    const map = lodash.keyBy(groupByContractList, 'contractBase32')
    return contractsBase32.map(base32=>map[base32]?.balance || 0)
}


if (module === require.main) {
    init().then(cfg=>{
        const args = process.argv.slice(2)
        let from = args[0]
        return new NftService().checkAll(Number(from))
    }).then(()=>{
        return NftMint.sequelize.close()
    })
}
