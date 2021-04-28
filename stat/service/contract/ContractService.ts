import { listAllContract } from "../../model/ContractInfo";
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
        (await listAllContract()).forEach(c=>{
            this.map.set(c.base32, c.name)
        })
    }

    public getName(addr: string) {
        const info = this.map.get(addr)
        return info ? info.name : null
    }
}