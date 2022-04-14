import {Erc1155Data} from "../../model/Token";
import {Sequelize} from "sequelize";
import {KEY_1155data_EPOCH, KV} from "../../model/KV";
import {Conflux, Contract} from "js-conflux-sdk";

export const destroyedContracts = new Set<string>()
export const CONFIRM_GAP = 100

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
    const max = await Erc1155Data.findOne({order:[['id','desc']]})
    if (max) {
        let upperId = max.id
        do {
            let lowerId = upperId - 10_000
            const minOne = await Erc1155Data.findOne({
                where: Sequelize.literal(` latestEpoch - epoch < ${CONFIRM_GAP
                } and id between ${lowerId} and ${upperId} `),
                order: [['id','asc']]
            })
            if (!minOne) {
                console.log(` all record within [${lowerId} , ${upperId}] is beyond confirm gap ${CONFIRM_GAP}.`)
                break;
            } else if (minOne.id == lowerId) {
                // there may be smaller one.
                upperId = minOne.id
                console.log(` search deeper, now at ${minOne.id}`)
            } else {
                // this is the smallest one, rewind
                await KV.saveNumber(KEY_1155data_EPOCH, minOne.epoch - 1, null)
                console.log(` Sync1155data rewind to epoch ${minOne.epoch - 1}`)
                break;
            }
        } while (true)
    }
}