import {Conflux} from "js-conflux-sdk";
import {RoundRobin} from "./RoundRobin";

export type WAIT = 'wait'
// use rpc sub to manage pivot switch. WIP.
export type POP = 'pop'
export type OK = 'ok'
export type ACTION = WAIT|POP|OK
class LoadedResult<T> {
    action: ACTION
    data:T
    constructor(action:ACTION, data?:T) {
        this.action = action
        this.data = data
    }
}
export class CheckPivotHashError extends Error{}
export const WAIT_RESULT:any = new LoadedResult("wait")
export class PreLoader<T> {
    cfx:Conflux
    fn: (epoch:number)=>any
    delayEpoch: number;
    data = new Map<number, T>()
    preLoadSize = 20
    maxFetchedEpoch = -1
    latestState:number = 0
    stopBefore:number = -1

    fetchTimes = 0
    usedMs = 0
    lastMs = 0
    robin = new RoundRobin(50)

    constructor(cfx:Conflux, fn: (epoch:number)=>Promise<T>, delayEpoch:number, stopBefore:number) {
        this.cfx = cfx;
        this.fn = fn
        this.delayEpoch = delayEpoch
        this.stopBefore = stopBefore;
    }

    updating = false
    async updateLatestState(want) {
        if (this.updating) {
            return
        }
        this.updating = true;
        try {
            this.latestState = await this.cfx.getEpochNumber('latest_state');
        } catch (e) {
        }
        this.updating = false;
        console.log(`latest state epoch is ${this.latestState}, want ${want}`)
    }
    async get(epoch:number) : Promise<LoadedResult<T>> {
        await this.checkPreLoadSize(epoch);
        if (epoch > this.maxFetchedEpoch) {
            return WAIT_RESULT
        }
        let loaded = this.data.get(epoch)
        if (loaded === undefined) {
            console.log(` fetch right now: ${epoch}`)
            try {
                loaded = await this.fn(epoch)
            } catch (e) {
                loaded = e;
            }
        } else {
            // console.log(` from pre loaded ${epoch}`)
            this.data.delete(epoch)
        }
        return new LoadedResult<T>("ok", loaded)
    }
    async checkPreLoadSize(wantEpoch: number) {
        let needUpdate = true;
        if (this.maxFetchedEpoch === -1) {
            this.maxFetchedEpoch = wantEpoch - 1
            await this.updateLatestState(wantEpoch)
            needUpdate = false;
            console.log(` --------- start fetch from ${wantEpoch}, pre load size ${this.preLoadSize
            }, data size ${this.data.size}`)
        }
        while(this.data.size <= this.preLoadSize) {
            const fetchEpoch = this.maxFetchedEpoch + 1
            if (fetchEpoch > this.latestState - this.delayEpoch) {
                needUpdate && await this.updateLatestState(wantEpoch)
                break;
            }
            if (fetchEpoch === this.stopBefore) {
                // console.log(`preload reach end, ${this.stopBefore}`)
                break;
            }
            const startMs = Date.now()
            let v:T;
            try {
                v = await this.fn(fetchEpoch)
            } catch (e) {
                // console.log(` pre load outer catch, ${e.message}`)
                v = e
            }
            this.fetchTimes++
            this.lastMs = Date.now() - startMs;
            this.usedMs += this.lastMs;
            this.robin.push(this.lastMs)

            // console.log(` pre load ${fetchEpoch}, set value ${typeof v}, ${v}`)
            this.data.set(fetchEpoch, v);
            this.maxFetchedEpoch = fetchEpoch;
        }
    }

    dumpMetrics(prefixMsg:string = '') {
        console.log(`${prefixMsg} fetch ${this.fetchTimes} used ${this.usedMs
        }, avg ${(this.usedMs / (this.fetchTimes || 1)).toPrecision(5)
        }, latest ${this.robin.len} avg ${this.robin.avg().toPrecision(5)}`)
    }
}