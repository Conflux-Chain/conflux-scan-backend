import {
    KEY_PRUNE_ADJUST_BY_SBM,
    KEY_PRUNE_DEL_ROWS_PER_LOOP,
    KEY_PRUNE_DELAY_EPOCHS_AGAINST_LATEST,
    KEY_PRUNE_EPOCH_ADDR_TRANSFER,
    KEY_PRUNE_EPOCH_BLOCK,
    KEY_PRUNE_EPOCH_CFX_TRANSFER,
    KEY_PRUNE_EPOCH_TOKEN_TRANSFER,
    KEY_PRUNE_EPOCHS_PER_TIME,
    KEY_PRUNE_SLEEP_MS_PER_LOOP,
    KV
} from "../../model/KV"
import {AddressTransactionIndex, FullBlock, FullTransaction, loadMaxBlockEpoch} from "../../model/FullBlock"
import {EpochHashTokenTransfer} from "../../TokenTransferSync"
import {EpochHashCfxTransfer} from "../../CfxTransferSync"
import {Epoch} from "../../model/Epoch"
import {AddressTransfer} from "../../model/AddrTransfer"
import {PruneInfo, PruneType} from "../../model/PruneInfo"
import {Op, QueryTypes} from "sequelize"
import {AddressCfxTransfer, CfxTransfer} from "../../model/CfxTransfer"
import {AddressErc20Transfer, Erc20Transfer} from "../../model/Erc20Transfer"
import {AddressErc721Transfer, Erc721Transfer} from "../../model/Erc721Transfer"
import {AddressErc1155Transfer, Erc1155Transfer} from "../../model/Erc1155Transfer"
import {FullMinerBlock} from "../../model/FullMinerBlock"
import {loadConfig, StatConfig} from "../../config/StatConfig"
import {redirectLog} from "../../config/LoggerConfig"
import {StatApp} from "../../StatApp"
import {registerProcessHook, sleep} from "../tool/ProcessTool"
import {createDB, getSlaveStatus, initModel} from "../DBProvider"
import {doHeartBeat, KEY_PRUNE} from "../../model/HeartBeat"

const lodash = require('lodash');

class Options {
    table: string                // prune_info: prune address from prune_info, address_transfer: prune address_transfer, all: prune all tables
    type: string                 // skip if max epoch is less than pruned epoch, 1-skip, 0-not skip
    skipPrunedEpoch?: number = 1 // only used for table = 'prune_info', refer to PruneType, it will prune all type if pruneType is not set
}

export class PruneService {
    private readonly config: StatConfig
    private readonly opts: Options
    private switchAdjustBySbm: boolean
    private KEEP_ROWS = 20000
    private sbmLastTime = 0
    private pruneHappens = false
    private pruneCfg = {
        pruneEpochsPerTime: 100,
        delRowsPerLoop: 500,
        sleepMsPerLoop: 20,
        delayEpochsAgainstLatest: 1000,
    }

    public constructor(config: StatConfig, opts?: Options) {
        this.config = config
        this.opts = opts
    }

    public async checkSlaveStatus() {
        this.switchAdjustBySbm = await KV.getSwitch(KEY_PRUNE_ADJUST_BY_SBM)
        if(this.switchAdjustBySbm) {
            try{
                const slaveStatus = await getSlaveStatus(KV.sequelize)
                if(!slaveStatus) {
                    console.log(`get null salve status`) // Run prune service on master db.
                    process.exit(9)
                }
            } catch (err) {
                console.log(`get salve status fail:`, err) // Error occurs, eg. insufficient permission.
                process.exit(9)
            }
        }
    }

    public async refreshConfig(delay = 60_000) {
        const that = this
        async function repeat() {
            await that.getConfig().catch(err=>{
                console.log(`refresh_prune_conf fail: `, err)
            })
            setTimeout(repeat, delay)
        }
        repeat().then()
        console.log(`schedule refresh_prune_conf service in ${delay/1000}s interval`)
    }

    public async run(delay = 1000) {
        const that = this
        async function repeat() {
            await that.prune()
            setTimeout(repeat, that.pruneHappens ? 0 : delay)
            that.pruneHappens = false
        }
        repeat().then()
        console.log(`schedule prune service in ${delay/1000}s interval`)
    }

    private async getConfig(){
        let [pruneEpochsPerTime, delRowsPerLoop, sleepMsPerLoop, delayEpochsAgainstLatest] = await Promise.all([
            KV.getNumber(KEY_PRUNE_EPOCHS_PER_TIME, this.pruneCfg.pruneEpochsPerTime),
            KV.getNumber(KEY_PRUNE_DEL_ROWS_PER_LOOP, this.pruneCfg.delRowsPerLoop),
            KV.getNumber(KEY_PRUNE_SLEEP_MS_PER_LOOP, this.pruneCfg.sleepMsPerLoop),
            KV.getNumber(KEY_PRUNE_DELAY_EPOCHS_AGAINST_LATEST, this.pruneCfg.delayEpochsAgainstLatest),
        ])

        // Adjust the parameter `delRowsPerLoop` according to the `Seconds_Behind_Master` status of MySQL.
        // If sbm is greater than 200 and is greater than the previous value, subtract 50 from delRowsPerLoop.
        if(this.switchAdjustBySbm) {
            const status = await getSlaveStatus(KV.sequelize) as any
            const sbm = status?.Seconds_Behind_Master
            if (lodash.isNumber(sbm)) {
                if (sbm > 200 && this.sbmLastTime > 200 && (sbm - this.sbmLastTime) > 0) {
                    delRowsPerLoop -= 50
                    delRowsPerLoop = Math.max(delRowsPerLoop, 1)
                    await KV.saveNumber(KEY_PRUNE_DEL_ROWS_PER_LOOP, delRowsPerLoop, undefined)
                } else if (sbm === 0) {
                    delRowsPerLoop += 50
                    await KV.saveNumber(KEY_PRUNE_DEL_ROWS_PER_LOOP, delRowsPerLoop, undefined)
                }
                this.sbmLastTime = sbm
            }
        }

        this.pruneCfg = {
            pruneEpochsPerTime,
            delRowsPerLoop,
            sleepMsPerLoop,
            delayEpochsAgainstLatest,
        }
    }

    private async prune() {
        if(this.opts?.table === 'prune_info') {
            await this.pruneByPruned(this.opts?.type)
        } else if(this.opts?.table === 'address_transfer') {
            await this.pruneAddrTs()
        } else{
            await this.pruneAddrBlkTx()
            await this.pruneAddrCfxTs()
            await this.pruneAddrTokenTs()
            await this.pruneAddrTs()
        }
    }

    private async pruneAddrBlkTx() {
        const epochs = await this.getEpochsToPrune(KEY_PRUNE_EPOCH_BLOCK)
        const epochBlock: number = await loadMaxBlockEpoch()

        if(epochs.maxEpoch <= epochBlock - this.pruneCfg.delayEpochsAgainstLatest){
            const sql = `select distinct(minerId) as id from ${FullBlock.getTableName()} where epoch >= :minEpoch and epoch <= :maxEpoch`
            await this.pruneTable(PruneType.MINER_BLOCK, epochs, sql)
            await this.pruneTable(PruneType.ADDR_TX, epochs)
            await KV.upsert({key: KEY_PRUNE_EPOCH_BLOCK, value: `${epochs.maxEpoch}`})
        }
    }

    private async pruneAddrCfxTs() {
        const epochs = await this.getEpochsToPrune(KEY_PRUNE_EPOCH_CFX_TRANSFER)
        const epochCfxTs: number = await EpochHashCfxTransfer.max('epoch')

        if(epochs.maxEpoch <= epochCfxTs - this.pruneCfg.delayEpochsAgainstLatest){
            await this.pruneTable(PruneType.ADDR_CFX_TRANSFER, epochs)
            await KV.upsert({key: KEY_PRUNE_EPOCH_CFX_TRANSFER, value: `${epochs.maxEpoch}`})
        }
    }

    private async pruneAddrTokenTs() {
        const epochs = await this.getEpochsToPrune(KEY_PRUNE_EPOCH_TOKEN_TRANSFER)
        const epochTokenTs: number = await EpochHashTokenTransfer.max('epoch')

        if(epochs.maxEpoch <= epochTokenTs - this.pruneCfg.delayEpochsAgainstLatest){
            await this.pruneTable(PruneType.ADDR_ERC20_TRANSFER, epochs)
            await this.pruneTable(PruneType.ADDR_ERC721_TRANSFER, epochs)
            await this.pruneTable(PruneType.ADDR_ERC1155_TRANSFER, epochs)
            await KV.upsert({key: KEY_PRUNE_EPOCH_TOKEN_TRANSFER, value: `${epochs.maxEpoch}`})
        }
    }

    private async pruneAddrTs() {
        const epochs = await this.getEpochsToPrune(KEY_PRUNE_EPOCH_ADDR_TRANSFER)
        const epochBlock: number = await loadMaxBlockEpoch()
        const epochCfxTs: number = await EpochHashCfxTransfer.max('epoch')
        const epochTokenTs: number = await EpochHashTokenTransfer.max('epoch')
        const epochMisc: number = await Epoch.max('epoch')
        const delayEpochs = this.pruneCfg.delayEpochsAgainstLatest

        if (epochs.maxEpoch <= epochMisc - delayEpochs && epochs.maxEpoch <= epochBlock - delayEpochs
            && epochs.maxEpoch <= epochCfxTs - delayEpochs && epochs.maxEpoch <= epochTokenTs - delayEpochs) {
            await this.pruneTable( PruneType.ADDR_TRANSFER, epochs)
            await KV.upsert({key: KEY_PRUNE_EPOCH_ADDR_TRANSFER, value: `${epochs.maxEpoch}`})
        }
    }

    private async pruneByPruned(pruneType?: any) {
        let types
        if(pruneType) {
            types = [pruneType]
        } else{
            types = [PruneType.MINER_BLOCK, PruneType.ADDR_TX, PruneType.ADDR_CFX_TRANSFER,
                PruneType.ADDR_ERC20_TRANSFER, PruneType.ADDR_ERC721_TRANSFER, PruneType.ADDR_ERC1155_TRANSFER,
                PruneType.ADDR_TRANSFER]
        }
        const sql = `select addressId from ${PruneInfo.getTableName()} where type = ?`
        for (const type of types) {
            const addressIds = await PruneInfo.sequelize.query(sql, {
                type: QueryTypes.SELECT, replacements: [type], raw: true
            }).then(items => {return items.map(item => item['addressId'])})
            for (const addressId of addressIds) {
                await this.pruneAddress(addressId, type)
            }
        }
    }

    private async getEpochsToPrune(pruneType: string): Promise<{minEpoch: number, maxEpoch: number}> {
        const curEpoch = await KV.getNumber(pruneType, 0)
        const minEpoch = curEpoch + 1
        const maxEpoch = minEpoch + this.pruneCfg.pruneEpochsPerTime - 1
        return {minEpoch, maxEpoch}
    }

    private async pruneTable(type, epochs, sql?) {
        const [fullModels, _] = this.getTables(type)
        const _sql = sql ? sql : this.getSql(fullModels as any[])
        const addressIds: any[] = await fullModels[0].sequelize.query(_sql, {
            type: QueryTypes.SELECT, replacements: {minEpoch: epochs.minEpoch, maxEpoch: epochs.maxEpoch}, raw: true
        }).then(items => {return items.map(item => item.id)})

        for (const addressId of addressIds) {
            await this.pruneAddress(addressId, type, epochs.maxEpoch)
        }
        this.pruneHappens = true
    }

    private async pruneAddress(addressId, type, maxEpoch?) {
        const [_, model] = this.getTables(type)
        const whereOpt = model === FullMinerBlock ? {minerId: addressId} : {addressId}
        const one = await (model as any).findOne({
            where: whereOpt, order: [["epoch", "desc"]], offset: this.KEEP_ROWS, limit: 1, raw: true
        })
        if (!one) {
            return
        }

        let prune = await PruneInfo.findOne({ where: {addressId, type}, raw: true})
        if (!prune) {
            prune = await PruneInfo.create({addressId, type, pruned: 0, epoch: one.epoch} as PruneInfo)
        }
        if(this.opts?.skipPrunedEpoch && lodash.isNumber(maxEpoch) && maxEpoch < prune.epoch) { // skip if max epoch is less than pruned epoch
            return
        }
        console.log(`pruneAddress ------ ${addressId} ${maxEpoch} ${prune.epoch}`)

        let del
        let pruned = prune.pruned
        let loop = 0
        do {
            await PruneInfo.sequelize.transaction(async (dbTx) => {
                del = await (model as any).destroy({transaction: dbTx,
                    where: {...whereOpt, epoch: {[Op.lt]: one.epoch}}, limit: this.pruneCfg.delRowsPerLoop})
                if (del) {
                    pruned += del
                    await PruneInfo.update({pruned, epoch: one.epoch}, {
                        transaction: dbTx, where: {id: prune.id}})
                }
            })

            this.pruneCfg.sleepMsPerLoop && await sleep(this.pruneCfg.sleepMsPerLoop)
            await doHeartBeat(KEY_PRUNE+this.config.serverTag)
            if(++loop % 10 === 0) {
                console.log(`prune ${type} ${addressId} ${this.pruneCfg.delRowsPerLoop} ${pruned - prune.pruned}`)
            }
        } while (del > 0)
    }

    private getTables(type) {
        switch (type) {
            case PruneType.MINER_BLOCK:
                return [[FullBlock], FullMinerBlock]
            case PruneType.ADDR_TX:
                return [[FullTransaction], AddressTransactionIndex]
            case PruneType.ADDR_CFX_TRANSFER:
                return [[CfxTransfer], AddressCfxTransfer]
            case PruneType.ADDR_ERC20_TRANSFER:
                return [[Erc20Transfer], AddressErc20Transfer]
            case PruneType.ADDR_ERC721_TRANSFER:
                return [[Erc721Transfer], AddressErc721Transfer]
            case PruneType.ADDR_ERC1155_TRANSFER:
                return [[Erc1155Transfer], AddressErc1155Transfer]
            case PruneType.ADDR_TRANSFER:
                return [[FullTransaction,CfxTransfer,Erc20Transfer,Erc721Transfer,Erc1155Transfer], AddressTransfer]
            default:
                throw new Error(`Prune type ${type} not supported`)
        }
    }

    private getSql(fullModels: any[]): string {
        return fullModels.map(fullModel => this.getSql0(fullModel)).join('\nunion\n')
    }

    private getSql0(fullModel): string {
        return `select distinct(fromId) as id from ${fullModel.getTableName()} where epoch >= :minEpoch and epoch <= :maxEpoch
                \r union 
                \r select distinct(toId) as id from ${fullModel.getTableName()} where epoch >= :minEpoch and epoch <= :maxEpoch`
    }

    public async close() {
        await KV.sequelize.close();
    }
}

async function start(opts: any) {
    const config = loadConfig('Prod')
    if(!config.syncPrune) {
        console.log(`sync prune not set`)
        return
    }
    redirectLog({mainPath: 'PruneService'})

    StatApp.readonly = config.database.readonly
    const sequelize = createDB(config.databaseRW)
    await initModel(sequelize)
    if (config.database.syncSchema) {
        console.log(`sync model begin...`)
        await sequelize.sync({})
        console.log(`sync model finished.`)
    } else {
        console.log(`skip sync db schema.`)
    }

    const srv = new PruneService(config, opts)
    await srv.checkSlaveStatus()
    await srv.refreshConfig()
    await srv.run()

    registerProcessHook(srv)
}

// node script prune_info       [skipPrunedEpoch] [pruneType] # prune by prune_info, it needs provide param `skipPrunedEpoch` if use param `pruneType`
// node script address_transfer [skipPrunedEpoch]             # prune address_transfer
// node script all              [skipPrunedEpoch]             # prune all tables
if (module === require.main) {
    const args = process.argv.slice(2)
    const opts: Options = new Options()
    if(args[0]) {
        opts.table = args[0]
    }
    if(args[1]) {
        opts.skipPrunedEpoch = Number(args[1])
    }
    if(opts.table === 'prune_info' && args[2]) {
        opts.type = args[2]
    }
    start(opts).then()
}
