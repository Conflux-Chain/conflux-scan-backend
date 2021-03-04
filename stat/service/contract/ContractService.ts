import {fmtDtUTC} from "../../model/Utils";

const superagent = require("superagent")
/**
 * Fetch contract information from base scan, and save it's name.
 */
export class ContractService{
    private networkId: number;
    private readonly scanApiUrl: string;
    private skip = 0
    public map: Map<string, any>
    static instance:ContractService
    constructor(scanApiUrl:string, networkId:number) {
        this.scanApiUrl = scanApiUrl
        this.networkId = networkId
        this.map = new Map<string, any>()
        ContractService.instance = this
    }
    public schedule(delay: number = 10_000) {
        console.log(`schedule contract service in delay ${delay/1000}s.`)
        const that = this
        async function repeat() {
            await that.run()
            setTimeout(repeat, delay)
        }
        repeat().then()
    }

    async run() {
        const limit = 100
        console.log(`${fmtDtUTC(new Date())} fetch contract list, skip ${this.skip} , from ${this.scanApiUrl}`)
        superagent.get(`${this.scanApiUrl}/v1/contract?reverse=false&skip=${this.skip}&limit=${limit}&fields=name`)
            .timeout(10_000)
            .end((err, res)=>{
                if (err || res.status !== 200) {
                    console.log(`fetch contract fail:`, err)
                    return
                }
                const json = res.body
                json.list.forEach(cc=>{
                    // "address": "CFXTEST:TYPE.CONTRACT:ACAKT4A22NBPCYWPJH2T3TRBJRKAAV0VC6ENUEYD0G",
                    this.map.set(cc.address, cc)
                })
                console.log(`${fmtDtUTC(new Date())} map size ${this.map.size}, total ${json.total}`)
                //
                this.skip += limit
                if (this.skip >= json.total) {
                    this.skip = 0
                }
            })
    }

    public getName(addr: string) {
        // "address": "CFXTEST:TYPE.CONTRACT:ACAKT4A22NBPCYWPJH2T3TRBJRKAAV0VC6ENUEYD0G",
        const info = this.map.get(addr)
        return info ? info.name : null
    }
}