// Sync pos things that happen on pow side.
import {Conflux} from "js-conflux-sdk";
import {IPosRegister, PosAccount, PosRegister} from "../../model/PoS";
import {abi as posAbi} from "../abi/PoSRegister";
import {initCfxSdk, removeLongData} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {StatApp} from "../../StatApp";
import {Transaction} from "sequelize";

export class PowSidePosSync {
    // will be set when system startup.
    static POS_CONTRACT_VERBOSE = 'CFX:TYPE.BUILTIN:AAEJUAAAAAAAAAAAAAAAAAAAAAAAAAAAAYF993UFD7'
    static POS_CONTRACT_HEX = '0x0888000000000000000000000000000000000005'
    private cfx: Conflux;
    private posContract: any;
    private posContractAddr: string;
    isPosRpc = true;
    constructor(cfx: Conflux) {
        this.cfx = cfx;
    }
    async init() {
        if(StatApp.isEVM) {
            return
        }
        await this.cfx.updateNetworkId();
        console.log(` PowSidePosSync network id ${this.cfx['networkId']}`)
        this.posContractAddr = PowSidePosSync.POS_CONTRACT_HEX
        this.posContract = this.cfx.Contract({abi: posAbi, address: this.posContractAddr})
    }
    async checkPosRegister(receipts2d:any[][], epoch: number, blockTime: Date, dbTx: Transaction) {
        if(StatApp.isEVM) {
            return
        }
        const arr:IPosRegister[] = []
        // check it , send to mq by condition.
        for (let receipts of receipts2d) {
            for (let receipt of receipts) {
                let logIdx = 0
                for (let log of receipt.logs) {
                    log.transactionLogIndex = logIdx++;
                    if (log.address === PowSidePosSync.POS_CONTRACT_VERBOSE) {
                        log.transactionHash = receipt.transactionHash;
                        const bean = await this.sync(epoch, log, blockTime, dbTx)
                        arr.push(bean);
                    }
                }
            }
        }
        return arr;
    }
    async sync(epoch, log, blockTime, dbTx) {
        const bean:IPosRegister = {
            epoch,
            txHash: log['transactionHash'],
            powBase32: '', identifier: '',
            transactionLogIndex: log.transactionLogIndex,
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
            await PosAccount.make(decoded.identifier, blockTime)
            // console.log(' decoded:', obj)
        } else if (log["topics"][0]?.startsWith('0xcacdde07b9b')) {//retire
            // 0xe13f3e895baf53075eec116787300f2ebbf62420db8a58dede6aea2d084a71b7
            let decoded: any;
            try {
                decoded = this.posContract.Retire.decodeLog(log);
            } catch (e) {
                console.log(` decode log fail, at epoch ${epoch}`)
                throw e;
            }
            // const obj = decoded.toObject();
            bean.identifier = decoded.identifier
            bean.retire = true
        } else {
            throw new Error(` unexpected pos register topic, at epoch ${epoch}, topic ${log["topics"][0]}`)
        }
        // await PosRegister.create(bean, {transaction: dbTx})
        console.log(` pos register, epoch ${epoch}`);
        return bean;
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
    init().then(async (config) => {
        const cfxUrl = url || config.conflux.url;
        console.log(`use cfx ${cfxUrl}`)
        const cfx = await initCfxSdk({url: cfxUrl});
        const sync = new PowSidePosSync(cfx)
        sync.init().then(()=>{
            if (args.includes('retire')) {
                const privateKey = args.filter(s=>s.startsWith('0x'))
                const randomAccount = cfx.wallet.addRandom()
                return sync.testRetire(randomAccount.toString()).then(res=>{
                    console.log(` retire tx:`, res)
                })
            } else {
                console.log(` supported action < retire | listen | single >`)
            }
        }).then(()=>{
            return PosRegister.sequelize.close()
        })
    })
}
