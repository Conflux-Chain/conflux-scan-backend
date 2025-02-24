import {Erc1155Data, NftMint, Token} from "../../model/Token";
import {Hex40Map} from "../../model/HexMap";
import {init} from "./FixDailyTokenStat";
import {check721OwnerInDb} from "./TokenTool";
import {initCfxSdk} from "../common/utils";
import {Epoch} from "../../model/Epoch";
import {Op} from "sequelize";
import {EpochHashTokenTransfer} from "../../TokenTransferSync";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {AddressNftTransfer, NftTransfer} from "../../model/NftTransfer";
import {CONST} from "../common/constant";
import {AddressTransfer} from "../../model/AddrTransfer";

const {abi: abi1155} = require('../watcher/contract/miniERC1155.json')
const abi = require('./abi');


async function fetchBalance(addrId:number, tokenId:string, nftContract:any) {
    return Hex40Map.findByPk(addrId).then(res=>'0x'+res.hex)
        .then(hex=>{
            return nftContract.balanceOf(hex, BigInt(tokenId)).then(b=>{
                return {hex, balance:b}
            })
        })
}
//
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
                // await NftMint.update({toId: data.addressId, epoch: data.epoch, updatedAt: data['updatedAt']}, {
                //     where: {id: mint.id}
                // })
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
    const [,,cmd,contractId] = process.argv
    if (cmd === 'check721OwnerInDb') {
        // after fixing owner, plz fix holder by
        // node stat/dist/service/watcher/BatchBalanceWatcher.js fixNftHolder 123
        return check721OwnerInDb();
    }
    const config = await init();
    cfx = await initCfxSdk(config.conflux)
    if (cmd === 'checkNftMint') {
        await checkNftMint(parseInt(contractId))
        console.log(`done`)
    } else if (cmd === 'fix721value') {
        await fix721value();
    } else {
        console.log(`unknown command [${cmd}]`)
    }
    await NftMint.sequelize.close()
    process.exit(0)
}
async function fixNftTx(addrId: number, e: number) {
    const adrNftArr = await NftTransfer.findAll({
        where: {epoch: e, type: CONST.ADDRESS_TRANSFER_TYPE.ERC721.code},
    })
    let goodCount = 0;
    for (const addressNftTransfer of adrNftArr) {
        if (addressNftTransfer.value == '1') {
            console.log(`ok`);
            goodCount ++;
            continue;
        }
        addressNftTransfer.value = '1';
        await addressNftTransfer.save();
        console.log(`fix nft ${addrId} epoch ${e} contract ${addressNftTransfer.contractId} time ${addressNftTransfer.createdAt.toISOString()}`)
    }
    console.log(` nft  aid ${addrId} epoch ${e}`, adrNftArr.length, ` ${goodCount ? '' : "----- ??? -----"}`);
}
async function fixAdrNftTx(addrId: number, e: number) {
    const adrNftArr = await AddressNftTransfer.findAll({
        where: {addressId: addrId, epoch: e, type: CONST.ADDRESS_TRANSFER_TYPE.ERC721.code},
    })
    let goodCount = 0;
    for (const addressNftTransfer of adrNftArr) {
        if (addressNftTransfer.value == '1') {
            console.log(`ok`);
            goodCount ++;
            continue;
        }
        addressNftTransfer.value = '1';
        await addressNftTransfer.save();
        console.log(`fix adr nft ${addrId} epoch ${e} contract ${addressNftTransfer.contractId} time ${addressNftTransfer.createdAt.toISOString()}`)
    }
    console.log(`adr nft aid ${addrId} epoch ${e} `, adrNftArr.length, ` ${goodCount ? '' : "----- ??? -----"}`);
}
async function fixAdrTokenTx(addrId: number, e: number) {
    const adrNftArr = await AddressTransfer.findAll({
        where: {addressId: addrId, epoch: e, type: CONST.ADDRESS_TRANSFER_TYPE.ERC721.code},
    })
    let goodCount = 0;
    for (const addressNftTransfer of adrNftArr) {
        if (addressNftTransfer.value == '1') {
            console.log(`ok`);
            goodCount ++;
            continue;
        }
        addressNftTransfer.value = '1';
        await addressNftTransfer.save();
        console.log(`fix adr token ${addrId} epoch ${e} contract ${addressNftTransfer.contractId} time ${addressNftTransfer.createdAt.toISOString()}`)
    }
    console.log(`adr token nft  aid ${addrId} epoch ${e} `, adrNftArr.length, ` ${goodCount ? '' : "----- ??? -----"}`);
}

async function fix721value() {
    const ep = await Epoch.findOne({
        where: {timestamp: {[Op.gt]: '2025-02-20'}},
        order: [['timestamp', 'asc']], raw: true,
    })
    console.log(`epoch `, ep);
    const endEp = await Epoch.findOne({order: [['epoch', 'desc']], raw: true});
    let e = ep.epoch - 1;
    while(e<=endEp.epoch) {
        const next = await Erc721Transfer.findOne({
            where: {epoch: {[Op.gt]: e}}, raw: true,
            order: [['epoch', 'asc']],
        })
        if (!next) {
            break;
        }
        e = next.epoch;
        const list = await Erc721Transfer.findAll({
            where: {epoch: {[Op.eq]: e}}, raw: true,
            order: [['epoch', 'asc']],
        });

        console.log(`epoch ${e} 721 count `, list.length);
        const addrIdSet = new Set<number>();
        list.forEach(e=>addrIdSet.add(e.fromId));
        list.forEach(e=>addrIdSet.add(e.toId));
        const addrIds = [...addrIdSet];
        for (const addrId of addrIds) {
            await fixAdrNftTx(addrId, e);
            await fixAdrTokenTx(addrId, e);
            await fixNftTx(addrId, e);
        }
    }
}

if (module === require.main) {
    main().then()
}
/*
 node stat/service/tool/NftOwnerCheck.js checkNftMint 996251
 node stat/service/tool/NftOwnerCheck.js fix721value
 */
