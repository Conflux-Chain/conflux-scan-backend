import {Erc1155Data, NftMint, Token} from "../../model/Token";
import {QueryTypes} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {Hex40Map} from "../../model/HexMap";
import {init} from "./FixDailyTokenStat";

const {abi: abi1155} = require('../watcher/contract/miniERC1155.json')
const abi = require('./abi');
async function fetchOwner(tokenId:string, nftContract:any) {

}
async function fetchBalance(addrId:number, tokenId:string, nftContract:any) {
    return Hex40Map.findByPk(addrId).then(res=>'0x'+res.hex)
        .then(hex=>{
            return nftContract.balanceOf(hex, BigInt(tokenId)).then(b=>{
                return {hex, balance:b}
            })
        })
}
//
async function checkNftMint721(contractId:number) {
    const token = await Token.findOne({
        attributes: {exclude: ['icon']}, where: {
            hex40id: contractId,
            // type: 'ERC1155'
        }
    })
    console.log(`token is ${token.base32} [${token.name}] ${token.type}`)
    if (token.type !== 'ERC1155') {
        console.log(`not 1155: ${token.type}`)
        process.exit(9)
    }
    nftContract = cfx.Contract({abi: abi1155, address: token.base32});
}
//
async function checkNftMint(contractId:number) {
    const token = await Token.findOne({attributes:{exclude: ['icon']},where:{hex40id: contractId,
            // type: 'ERC1155'
    }})
    console.log(`token is ${token.base32} [${token.name}] ${token.type}`)
    if (token.type !== 'ERC1155') {
        console.log(`not 1155: ${token.type}`)
        process.exit(9)
    }
    nftContract = cfx.Contract({abi: abi1155, address: token.base32});
    const mintList = await NftMint.findAll({
        where: {contractId}
    })
    const dataList = await Erc1155Data.findAll({
        where: {contractId}
    })
    console.log(`mint count ${mintList.length}, computed from transfer ${dataList.length}`)
    //
    const dataMap = new Map<any, Erc1155Data>()
    dataList.forEach(d=>dataMap.set(d.tokenId, d))
    let fixCnt = 0
    for (let i = 0; i < mintList.length; i++) {
        const mint = mintList[i]
        let data = dataMap.get(mint.tokenId)
        if (!data) {
            console.log(`not found in erc1155data. token ${mint.tokenId}`)
            // process.exit(9)
            // @ts-ignore
            const {hex, balance} = await fetchBalance(mint.toId, mint.tokenId, nftContract)
            console.log(`mint table ${hex } holds ${mint.tokenId} x ${balance}`)
            if (balance <= 0) {

            }
            continue
        }
        if (data.addressId === mint.toId) {
            // console.log(`match ${mint.tokenId}`)
            continue
        }
        if (token.type === 'ERC1155') {
            const [{hex: dataHex, balance: dataBalance}, {hex:mintHex, balance: mintBalance}] = await Promise.all([
                fetchBalance(data.addressId, data.tokenId, nftContract),
                fetchBalance(mint.toId, data.tokenId, nftContract),
            ])
            console.log(`token id ${data.tokenId}`)
            console.log(`nftData    ${dataHex} holds ${dataBalance}`)
            console.log(`mint table ${mintHex} holds ${mintBalance}`)
            if (dataBalance > 0 && mintBalance <= 0) {
                fixCnt+=1
                console.log(`           need fix ${fixCnt}`)
                await NftMint.update({toId: data.addressId, epoch: data.epoch, updatedAt: data['updatedAt']}, {
                    where: {id: mint.id}
                })
                // process.exit(8)
            }
        } else {
            console.log(`--- ? should be 1155`)
        }
    }
    console.log(`fix cnt ${fixCnt}`)
}
let nftContract;
let cfx;
async function main() {
    const cfg = await init();
    const [,,cmd,contractId] = process.argv
    cfx = new Conflux(cfg.conflux)
    if (cmd === 'checkNftMint') {
        await checkNftMint(parseInt(contractId))
        console.log(`done`)
        await NftMint.sequelize.close()
        process.exit(0)
        return
    } else {
        console.log(`unknown command [${cmd}]`)
    }
}

if (module === require.main) {
    main().then()
}
/*
 node stat/dist/service/tool/NftOwnerCheck.js checkNftMint 996251
 */