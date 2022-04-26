import {Conflux, Contract, format, Drip} from "js-conflux-sdk";
import {TokenTool} from "./TokenTool";
const abi = require('./abi');

class TokenMap {
    map = new Map<string, bigint>()
    public putTransfer(token:string, v:bigint) {
        let preV = this.map.get(token) || BigInt(0);
        this.map.set(token, preV + v)
    }
}
export class PpiLiquidity {
    private cfx: Conflux;
    tokenMap = new Map<string, string>()
    supplierInfo = new Map<string,TokenMap>()
    private contract: Contract;

    constructor(cfx: Conflux) {
        this.cfx = cfx
        this.contract = cfx.Contract({abi});
    }
    putTransfer(owner:string, token: string, v: bigint) {
        let info = this.supplierInfo.get(owner)
        if (!info) {
            info = new TokenMap()
            this.supplierInfo.set(owner, info)
        }
        info.putTransfer(token, v)
    }
    async cacheTokenName(token:string) {
        if (this.tokenMap.has(token)) {
            return
        }
        // @ts-ignore
        const name = await this.contract.name().call({to: token})
        this.tokenMap.set(token, name)
        // console.log(`token name ${token} ${name}`)
    }

    async processTx(hash: string) {
        const receipt = await this.cfx.getTransactionReceipt(hash);
        let {from, to, logs} = receipt
        from = format.hexAddress(from)
        to = format.hexAddress(to)
        for(const log of logs) {
            let [t, sender, receiver, value] = log.topics
            sender = '0x'+sender?.slice(-40)
            receiver = '0x'+receiver?.slice(-40)
            const emitFromContract = format.hexAddress(log.address)
            if (t === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                const v = BigInt(log.data || '0')
                // Transfer(index_topic_1 address from, index_topic_2 address to, uint256 value)
                if (eqIgnoreCase(from, sender)) {
                    // tx sender pay
                    this.putTransfer(from, log.address, -v)
                } else if (receiver === '0x0000000000000000000000000000000000000000') {
                    // burn, do not care
                } else if (emitFromContract === '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b'
                    && receiver === to) { // wcfx, from LPs to router, then withdraw
                    this.putTransfer(from,log.address, v)
                } else if (emitFromContract === '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b'
                    && sender === to) { // wcfx, from router to LPs
                    this.putTransfer(from,log.address, -v)
                } else if (eqIgnoreCase(receiver, from)) {
                    // tx sender receive
                    this.putTransfer(from, log.address, v)
                } else if (sender === '0x0000000000000000000000000000000000000000' && receiver !== from) {
                    // ppi to someone unknow
                } else if (!eqIgnoreCase(sender, from) && eqIgnoreCase(receiver, to)) {
                    // refund, middle step: token from LPs to Router
                } else {
                    console.log(`unknown action at tx ${hash} \n sender ${sender} , receiver ${receiver
                    }\n token ${emitFromContract} x ${v} \n tx from ${from} to ${to}`)
                    process.exit(0)
                }
                await this.cacheTokenName(log.address)
            }
        }
    }

    dumpInfo() {
        for(const who of this.supplierInfo.keys()) {
            const info = this.supplierInfo.get(who)
            console.log(`${who}`)
            for (const token of info.map.keys()) {
                const tkHex = format.hexAddress(token)
                const v = info.map.get(token)
                const cfx = new Drip(Number(v > 0 ? v : -v)).toCFX()
                console.log(`\t ${(this.tokenMap.get(token) +' ' + tkHex.substring(0, 6)).padStart(26,' ')
                } ${v.toString().padStart(28, ' ')} ${v > 0 ? ' ': '-'}${cfx}`)
            }
        }
    }
    dumpCsv() {
        console.log(`address,token name,token address,send/receive drip,send/receive unit`)
        for(const who of this.supplierInfo.keys()) {
            const info = this.supplierInfo.get(who)
            console.log(`${who}`)
            for (const token of info.map.keys()) {
                const tkHex = format.hexAddress(token)
                const v = info.map.get(token)
                const cfx = new Drip(Number(v > 0 ? v : -v)).toCFX()
                console.log(`,${(this.tokenMap.get(token) +',' + tkHex)
                },'${v.toString()}',${v > 0 ? '': '-'}${cfx}`)
            }
        }
    }
}
export function eqIgnoreCase(a: string, b:string) {
    return a?.toLowerCase() === b?.toLowerCase()
}
async function main() {
    const [,,hash] = process.argv
    let cfx = new Conflux({url: 'http://8.210.68.176:32537/'})
    const ppi = new PpiLiquidity(cfx)
    await ppi.processTx(hash)
    // await ppi.processTx('0x981c604c0af4ad5395bab96209784be7b4b66165e2c9d8213384167d0e877a5a') // deposit cfx
    // await ppi.processTx('0x39ffd05253241604a33e1b362d573d1436fe5e461f437fefb6d3960f48f5a71b') // refund ppi
    // await ppi.processTx('0xf862bb0ee5c4a43ddddfc40f77134f463ab3c4c3334c49a624fd3b2413f6adfc') // refund cfx
    ppi.dumpInfo()
    // ppi.dumpCsv()
}

if (module === require.main) {
    main().then()
}
/*
node stat/dist/service/tool/PpiLiquidity.js hash
 */