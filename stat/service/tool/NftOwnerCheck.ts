import {Erc1155Data, NftMint, Token} from "../../model/Token";
import {QueryTypes} from "sequelize";
import {Conflux} from "js-conflux-sdk";
import {Hex40Map} from "../../model/HexMap";
import {init} from "./FixDailyTokenStat";

const {abi: abi1155} = require('../watcher/contract/miniERC1155.json')
async function checkNftMint(contractId:number) {
    const token = await Token.findOne({attributes:{exclude: ['icon']},where:{hex40id: contractId,
            // type: 'ERC1155'
    }})
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

    for (let i = 0; i < mintList.length; i++) {
        const mint = mintList[i]
        const data = dataMap.get(mint.tokenId)
        if (!data) {
            console.log(`not found in erc1155data. token ${mint.tokenId}`)
            process.exit(9)
        }
        if (data.addressId === mint.toId) {
            // console.log(`match ${mint.tokenId}`)
            continue
        }
        const [dataHex, mintHex] = await Promise.all([
            Hex40Map.findByPk(data.addressId).then(res=>'0x'+res.hex),
            Hex40Map.findByPk(mint.toId).then(res=>'0x'+res.hex),
        ])
        if (token.type === 'ERC1155') {
            const [dataBalance, mintBalance] = await Promise.all([
                nftContract.balanceOf(dataHex, BigInt(data.tokenId)),
                nftContract.balanceOf(mintHex, BigInt(data.tokenId)),
            ])
            console.log(`token id ${data.tokenId}`)
            console.log(`nftData    ${dataHex} holds ${dataBalance}`)
            console.log(`mint table ${mintHex} holds ${mintBalance}`)
            if (dataBalance > 0 && mintBalance < 0) {
                console.log(`need fix`)
                process.exit(8)
            }
        } else {
            console.log(`--- ? should be 1155`)
        }
    }
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