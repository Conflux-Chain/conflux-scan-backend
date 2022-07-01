import {Erc1155Data} from "../../model/Token";
import {Sequelize} from "sequelize";
import {KEY_1155data_EPOCH, KV} from "../../model/KV";
import {Conflux, Contract} from "js-conflux-sdk";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {Hex40Map} from "../../model/HexMap";

export const destroyedContracts = new Set<string>()
export const CONFIRM_GAP = 100

export const abi1155 = [{
    "inputs": [
        {
            "internalType": "address[]",
            "name": "accounts",
            "type": "address[]"
        },
        {
            "internalType": "uint256[]",
            "name": "ids",
            "type": "uint256[]"
        }
    ],
    "name": "balanceOfBatch",
    "outputs": [
        {
            "internalType": "uint256[]",
            "name": "",
            "type": "uint256[]"
        }
    ],
    "stateMutability": "view",
    "type": "function"
},
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "id",
                "type": "uint256"
            }
        ],
        "name": "balanceOf",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },]

export async function fetch1155balance(rpc: Contract, cfx:Conflux, params: any) {
    let balanceArr = [];
    try {
        // @ts-ignore
        balanceArr = await rpc.balanceOfBatch(params.accounts, params.tokenIds)
    } catch (err) {
        const account = await cfx.getAccount(rpc.address)
        if (account.codeHash === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470') {
            destroyedContracts.add(rpc.address)
            console.log(`contract code hash is empty. destroyed. ${rpc.address}`)
            return balanceArr
        }
        // fallback to balanceOf
        for (let i = 0; i < params.accounts.length; i++) {
            try {
                // @ts-ignore
                const b = await rpc.balanceOf(params.accounts[i], params.tokenIds[i])
                balanceArr.push(b)
            } catch (e) {
                if (e.data?.includes('owner query for nonexistent token')) {
                    balanceArr.push(BigInt(0))
                    console.log(`token not exist. ${rpc.address}, id ${params.tokenIds[i]}`)
                    continue
                }
                console.log(`call balanceOf fail`, params.accounts[i], params.tokenIds[i], e.data || e)
                break;
            }
        }
        if (balanceArr.length == params.accounts.length) {
            console.log(`  fix by balanceOf , ${rpc.address}`)
        } else {
            console.log(`call balanceOfBatch fail, contract ${rpc.address
            }, accounts ${params.accounts.join(',')} ids ${params.tokenIds.join(',')}`)
            if (err.data?.startsWith('VmError(OutOfStack')) {
                console.log(`  skip invalid contract, reason`, err.data)
            } else {
                throw err
            }
        }
    }
    return balanceArr
}
export async function rewind() {
    const max = await Erc1155Data.findOne({order:[['epoch','desc']]})
    if (!max) {
        return
    }
    let upperEpoch = max.epoch
    do {
        let lowerEpoch = upperEpoch - 100
        const minOne = await Erc1155Data.findOne({
            where: Sequelize.literal(` latestEpoch - epoch < ${CONFIRM_GAP
            } and epoch between ${lowerEpoch} and ${upperEpoch} `),
            order: [['epoch','asc']]
        })
        if (!minOne) {
            console.log(` all record within [${lowerEpoch} , ${upperEpoch}] is beyond confirm gap ${CONFIRM_GAP}.`)
            break;
        } else if (minOne.epoch == lowerEpoch) {
            // there may be smaller one.
            upperEpoch = minOne.epoch
            console.log(` search deeper, now at ${minOne.epoch}`)
        } else {
            // this is the smallest one, rewind
            await KV.saveNumber(KEY_1155data_EPOCH, minOne.epoch - 1, null)
            console.log(` Sync1155data rewind to epoch ${minOne.epoch - 1}`)
            break;
        }
    } while (true)
}

export async function fix1155data(cfx:Conflux) {
    await cfx.updateNetworkId();
    const list = await Erc1155Transfer.findAll({limit: 10_000})
    if (list.length === 10_000) {
        console.log(`too many records.`)
        process.exit(8)
    }
    console.log(`transfer count ${list.length}`)
    const contract = cfx.Contract({abi: abi1155})
    const skip = new Set<string>()
    for (let transfer of list) {
        const {contractId, fromId, toId, tokenId} = transfer;
        for (let addrId of [fromId, toId]) {
            const key = `${contractId}-${addrId}-${tokenId}`
            if (skip.has(key)) {
                continue
            }
            skip.add(key)
            const hex = await Hex40Map.findByPk(addrId).then(res=>`0x${res.hex}`)
            if (hex === '0x0000000000000000000000000000000000000000') {
                continue
            }
            const contractHex = await Hex40Map.findByPk(contractId).then(res=>`0x${res.hex}`);
            contract.address = contractHex;
            const amount = await contract.balanceOf(hex, BigInt(tokenId));
            console.log(`${hex} holds ${contractHex} ${tokenId} x ${amount}`)
        }
    }
    console.log(`done`)
}