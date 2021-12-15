import {Conflux} from "js-conflux-sdk";

export type WAIT = 'wait'
// use rpc sub to manage pivot switch. WIP.
export type POP = 'pop'
export type OK = 'ok'
export type ACTION = WAIT|POP|OK
class LoadedResult<T> {
    action: ACTION
    data:Promise<T>
    constructor(action:ACTION, data?:Promise<T>) {
        this.action = action
        this.data = data
    }
}
export const WAIT_RESULT:any = new LoadedResult("wait")
export class PreLoader<T> {
    cfx:Conflux
    fn: (epoch:number)=>any
    delayEpoch: number;
    data = new Map<number, Promise<T>>()
    preLoadSize = 20
    maxFetchedEpoch = -1
    latestState:number = 0

    fetchTimes = 0
    usedMs = 0
    lastMs = 0

    constructor(cfx:Conflux, fn: (epoch:number)=>Promise<T>, delayEpoch:number) {
        this.cfx = cfx;
        this.fn = fn
        this.delayEpoch = delayEpoch
    }

    async updateLatestState() {
        this.latestState = await this.cfx.getEpochNumber('latest_state')
        console.log(`latest state epoch is ${this.latestState}`)
    }
    get(epoch:number) : LoadedResult<T> {
        this.checkPreLoadSize(epoch);
        if (epoch > this.maxFetchedEpoch) {
            return WAIT_RESULT
        }
        let loaded = this.data.get(epoch)
        if (loaded === undefined) {
            console.log(` fetch right now: ${epoch}`)
            loaded = this.fn(epoch)
        } else {
            console.log(` from pre loaded ${epoch}`)
            this.data.delete(epoch)
        }
        return new LoadedResult<T>("ok", loaded)
    }
    checkPreLoadSize(wantEpoch: number) {
        if (this.maxFetchedEpoch === -1) {
            this.maxFetchedEpoch = wantEpoch - 1
            // this.updateLatestState().then() // will be triggered below.
            console.log(` start fetch from ${wantEpoch}, pre load size ${this.preLoadSize}, data size ${this.data.size}`)
        }
        while(this.data.size < this.preLoadSize) {
            const fetchEpoch = this.maxFetchedEpoch + 1
            if (fetchEpoch > this.latestState - this.delayEpoch) {
                this.updateLatestState().then()
                break;
            }
            const startMs = Date.now()
            const v = this.fn(fetchEpoch).finally(()=>{
                this.fetchTimes ++
                this.usedMs += (this.lastMs = Date.now() - startMs);
            })
            console.log(` pre load ${fetchEpoch}`)
            this.data.set(fetchEpoch, v);
            this.maxFetchedEpoch = fetchEpoch;
        }
    }
}