// Sync pos things that happen on pow side.
import {Conflux} from "js-conflux-sdk";
import {IPosRegister, PosAccount, PosBlock, PosRegister} from "../../model/PoS";
import {abi as posAbi} from "../abi/PoSRegister";
import {patchHttpProvider, removeLongData} from "../common/utils";
import {init} from "../tool/FixDailyTokenStat";
import {POW_EPOCH_FOR_POS_Q, RedisStreamMessage, RedisWrap} from "../RedisWrap";

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
        await this.cfx.updateNetworkId();
        console.log(` PowSidePosSync network id ${this.cfx['networkId']}`)
        this.posContractAddr = PowSidePosSync.POS_CONTRACT_HEX
        this.posContract = this.cfx.Contract({abi: posAbi, address: this.posContractAddr})
    }
    static async sendMq(receipts2d:any[][], epoch) {
        // check it , send to mq by condition.
        for (let receipts of receipts2d) {
            for (let receipt of receipts) {
                if (receipt.address === PowSidePosSync.POS_CONTRACT_VERBOSE) {
                    return RedisWrap.sendStreamMessage({action:'push', epoch: epoch}, POW_EPOCH_FOR_POS_Q)
                }
            }
        }
    }
    // XADD POW_EPOCH_FOR_POS_Q * v1 '{"action":"pop", "epoch":0}'
    async listen() {
        try {
            await this.cfx.pos.getStatus()
        } catch (e) {
            if (e.message.includes('Method not found')) {
                this.isPosRpc = false;
                console.log(` not pos rpc, will drop all redis message.`)
            } else if (e.message.includes('PoS chain is not enabled')) {
                //
            } else {
                console.log(` can not determine pos rpc.`, e)
                process.exit(0)
            }
        }
        RedisWrap.listenStreamMessage(POW_EPOCH_FOR_POS_Q, (data)=>{
            return this.listenPowEpoch(data)
        }).then()
        console.log(` listen on queue : ${POW_EPOCH_FOR_POS_Q}`)
    }
    async listenPowEpoch(data:RedisStreamMessage[]) {
        if (!this.isPosRpc) {
            return RedisWrap.xDel(data)
        }
        const list:any[] = data.map(msg=>msg.message)
        for (const msg of list) {
            if (msg.action === 'pop') {
                await PosRegister.destroy({
                    where: {epoch: msg.epoch}
                });
                console.log(` PosRegister pop: ${msg.epoch} `);
            } else {
                await this.sync(msg.epoch);
            }
        }
        return RedisWrap.xDel(data)
    }
    async sync(epoch) {
        const filter = {
            fromEpoch:epoch, toEpoch: epoch,
            address: this.posContractAddr,
        };
        const [logs, block] = await Promise.all([
            this.cfx.getLogs(filter),
            this.cfx.getBlockByEpochNumber(epoch, false)
        ]).catch(err=> {
            if (err.message.includes('expected a numbers with less than largest epoch number')) {
                return []
            }
            throw err;
        })
        if (logs === undefined) {
            return;
        }
        if (epoch % 100 === 0) {
            console.log(` sync pos register event, logs count ${logs.length}, pow epoch ${epoch}`);
        }
        const dt = new Date(block.timestamp * 1000)
        const registerArr:IPosRegister[] = []
        // const registerArr:IPosRegister[] = []
        for (const log of logs) {
            // this.posContractAddr.Register
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
                await PosAccount.make(decoded.identifier, dt)
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
                console.log(` unexpected topic, at epoch ${epoch}, topic ${log["topics"][0]}`)
                // continue
                process.exit(9)
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
        const cfxUrl = url || cfg.conflux.url;
        console.log(` use cfx ${cfxUrl}`)
        const cfx = new Conflux({url: cfxUrl})
        const sync = new PowSidePosSync(cfx)
        sync.init().then(()=>{
            if (args.includes('retire')) {
                const privateKey = args.filter(s=>s.startsWith('0x'))
                const randomAccount = cfx.wallet.addRandom()
                return sync.testRetire(randomAccount.toString()).then(res=>{
                    console.log(` retire tx:`, res)
                })
            } else if (args.includes('listen')) {
                return RedisWrap.connect(cfg.redis).then(()=>{
                    return sync.listen()
                }).then(()=>{
                    // never resolve, just hangup.
                    return new Promise(resolve => {})
                })
            } else if (args.includes('single')) {
                return sync.sync(parseInt(args[1]));//131752)
            } else {
                console.log(` supported action < retire | listen | single >`)
            }
        }).then(()=>{
            return PosRegister.sequelize.close()
        })
    })
}