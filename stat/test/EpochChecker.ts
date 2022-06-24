import {Block, Transaction} from "js-conflux-sdk/dist/types/rpc/types/formatter";
import {Conflux} from "js-conflux-sdk"
import {sleep} from "../service/tool/ProcessTool";
import {patchHttpProvider} from "../service/common/utils";
const mismatchEpochs = new Set<number>()
const map = new Map<number, Block[][]>()
async function load(epoch:number, times:number, delay: number) {
    for (let i=0; i<times; i++) {
        const hashes = await cfx.getBlocksByEpochNumber(epoch);
        const blocks = await Promise.all(hashes.map(h=>{
            return cfx.getBlockByHash(h, true)
        }))
        const arr = map.get(epoch) || []
        arr.push(blocks)
        map.set(epoch, arr)
        await sleep(delay*i)
    }
    check(epoch, times, delay)
}
function check(epoch: number, times: number, delay: number) {
    const timesBlock = map.get(epoch)
    let sample = timesBlock[0]
    let match = true
    for (let time = 1; time < timesBlock.length; time++) {
        const blockCount = sample.length;
        let scopeMatch = true
        const target = timesBlock[time]
        if (target.length !== blockCount) {
            console.log(` block count mismatch, epoch ${epoch
            }, ${blockCount} != ${target.length} data times ${time}`)
            match = scopeMatch = false
            sample = target
            continue
        }
        for (let blockIdx = 0; blockIdx < target.length; blockIdx++) {
            const blkS = sample[blockIdx]
            const blkT = target[blockIdx]
            if (blkS.transactions.length !== blkT.transactions.length) {
                console.log(` tx length not match, epoch ${epoch}, ${blkS.transactions.length
                } VS ${blkT.transactions.length}, block ${blockIdx} data times ${time}`)
                match = scopeMatch = false
                sample = target
                continue
            }
            for (let txIdx = 0; txIdx < blkS.transactions.length; txIdx++) {
                const txS = blkS.transactions[txIdx] as Transaction;
                const txT = blkT.transactions[txIdx] as Transaction;
                if (txS.hash !== txT.hash) {
                    match = scopeMatch = false
                    console.log(` hash not match, epoch ${epoch}, block ${blockIdx
                    }, ${txS.hash} vs ${txT.hash}, tx idx ${txIdx} data times ${time}`)
                } else if (txS.status !== txT.status) {
                    match = scopeMatch = false
                    console.log(` status not match, epoch ${epoch}, block ${blockIdx
                    }, ${txS.status} vs ${txT.status}, tx idx ${txIdx} data times ${time}`)
                }
            }
        }
        sample = target; // move on, the last elements may matches.
        if (!match && scopeMatch) {
            console.log(` match again, epoch ${epoch}, data times ${time}`)
        }
    }
    if (!match) {
        // check reorg
        if (reOrgEpochSet.has(epoch)) {
            console.log(` pre-tracked re org ${epoch}`)
        } else {
            mismatchEpochs.add(epoch)
            console.log(` un-tracked re org, ${epoch}`)
        }
    }
    console.log(`check done ${epoch}, on chain epoch ${preEpoch}, times ${times} delay ${delay}, mismatch count ${mismatchEpochs.size}`);
}
let cfx:Conflux

// latest_state arrive,
// get block with detail N times, check tx status changing.
const reOrgEpochs:number[][] = []
const blockHashes = new Map<number, string[]>()
let preEpoch = 0;
const reOrgEpochSet = new Set<number>();
async function doIt() {
    const [,,url, t, d] = process.argv;
    const wsUrl = url.replace('12537', '12535');
    const times = parseInt(t || '100');
    const delay = parseInt(d || '20');
    cfx = new Conflux({url:wsUrl})
    // patchHttpProvider(cfx, {url})
    const ws = new Conflux({url: wsUrl})
    // @ts-ignore
    const subscription = await ws.subscribeEpochs('latest_state');
    // @ts-ignore
    subscription.on('data', async data => {
        let epoch = data.epochNumber
        const ph = data.epochHashesOrdered as string[]
        blockHashes.set(epoch, ph)
        if (epoch <= preEpoch) {
            reOrgEpochs.push([preEpoch, epoch])
            console.log(` re org : ${preEpoch} -> ${epoch}`)
            for (let i=epoch; i<= preEpoch; i++) {
                reOrgEpochSet.add(i);
                mismatchEpochs.delete(i)
            }
        }
        preEpoch = epoch
        load(epoch, times, delay).catch(err=>{
            console.log(` load data fail, epoch ${epoch}.`, err)
        })
        map.delete(epoch - 100);

        //
        if (epoch % 100 === 0) {
            console.log(`re org epoch count ${reOrgEpochSet.size}, mismatch epoch count ${mismatchEpochs.size}`)
        }
    });
    console.log(` begin .`)
}

doIt().then()