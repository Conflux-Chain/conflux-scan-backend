import {Conflux} from "js-conflux-sdk";

export type WAIT = 'wait'
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
export const WAIT_RESULT:any = new LoadedResult("wait")
class PreLoader<T> {
    cfx:Conflux
    fn: (epoch:number)=>any
    private delayEpoch: number;
    data: Map<number, T>
    private maxFetchedEpoch:number
    latestState:number
    constructor(cfx:Conflux, fn: (epoch:number)=>T, delayEpoch:number) {
        this.cfx = cfx;
        this.fn = fn
        this.delayEpoch = delayEpoch
    }
    async start() {
        return this.updateLatestState()
    }
    async updateLatestState() {
        this.latestState = await this.cfx.getEpochNumber('latest_state')
    }
    async get(epoch:number) : Promise<LoadedResult<T>> {
        if (epoch > this.latestState - this.delayEpoch) {
            return WAIT_RESULT
        }
        if (epoch > this.maxFetchedEpoch) {

        }
    }
}