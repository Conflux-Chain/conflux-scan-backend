// Sync pos things that happen on pow side.
import {Conflux} from "js-conflux-sdk";
import {IPosRegister, PosBlock, PosRegister} from "../../model/PoS";
import {abi as posAbi} from "../abi/PoSRegister";
import {patchHttpProvider, removeLongData} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";

export class PowSidePosSync {
    private cfx: Conflux;
    private position: number;
    private latestBlockNumber: 0;
    private posContract: any;
    private posContractAddr: string;
    constructor(cfx: Conflux) {
        this.cfx = cfx;
    }
    async init() {
        await this.cfx.updateNetworkId();
        console.log(` PowSidePosSync network id ${this.cfx['networkId']}`)
        const max = await PosRegister.max('epoch')
        this.position = isNaN(Number(max)) ? 1 : Number(max) + 1
        console.log(` PowSidePosSync db max epoch is ${max}, next position is `, this.position)
        this.posContractAddr = '0x0888000000000000000000000000000000000005'
        this.posContract = this.cfx.Contract({abi:posAbi, address: this.posContractAddr})
    }
    async sync(epoch) {
        const filter = {
            fromEpoch:epoch, toEpoch: epoch,
            address: this.posContractAddr,
        };
        const logs = await this.cfx.getLogs(filter)
        console.log( `logs count ${logs.length}, epoch ${epoch}`)
        const registerArr:IPosRegister[] = []
        // const registerArr:IPosRegister[] = []
        for (const log of logs) {
            // this.posContractAddr.Register
            const bean:IPosRegister = {
                epoch,
                txHash: log['transactionHash'],
                powBase32: '', identifier: ''
            }
            if (log["topics"][0]?.startsWith('0xf3c')) {//IncreaseStake
                const decoded = this.posContract.IncreaseStake.decodeLog(log).toObject()
                // console.log(' decoded:', decoded.toObject())
                bean.identifier = decoded.identifier
                bean.votePower = decoded.votePower
            } else if (log["topics"][0]?.startsWith('0xfa22')) {//Register
                const decoded = this.posContract.Register.decodeLog(log)
                const obj = decoded.toObject();
                bean.identifier = decoded.identifier
                bean.blsPubKey = obj['blsPubKey'].toString('hex')
                bean.vrfPubKey = obj['vrfPubKey'].toString('hex')
                // console.log(' decoded:', obj)
            } else {//retire
                const decoded = this.posContract.Retire.decodeLog(log)
                // const obj = decoded.toObject();
                bean.identifier = decoded.identifier
                bean.retire = true
            }
            registerArr.push(bean)
            // removeLongData(log)
            // console.log(` log is `, log)
        }
        await PosRegister.sequelize.transaction(async tx=>{
            await Promise.all([
                PosRegister.bulkCreate(registerArr),
            ])
        })
    }
    async pop(epoch) {

    }
    async testRetire(account:string) {
        return this.posContract.retire().sendTransaction({
            from: account
        }).executed().then(res=>{
            return removeLongData(res)
        })
    }
}

if (module===require.main) {
    const args = process.argv.slice(2)
    const url = args[0]
    init().then(cfg=>{
        const cfx = new Conflux({url: url||cfg.conflux.url})
        const sync = new PowSidePosSync(cfx)
        sync.init().then(()=>{
            if (args.includes('retire')) {
                const privateKey = args.filter(s=>s.startsWith('0x'))
                const randomAccount = cfx.wallet.addRandom()
                return sync.testRetire(randomAccount.toString()).then(res=>{
                    console.log(` retire tx:`, res)
                })
            }
            return sync.sync(131752)
        }).then(()=>{
            return PosRegister.sequelize.close()
        })
    })
}