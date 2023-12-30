import {
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
import {AddressTransactionIndex, FullBlock, FullTransaction} from "../../model/FullBlock"
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
import {loadConfig} from "../../config/StatConfig"
import {redirectLog} from "../../config/LoggerConfig"
import {initCfxSdk} from "../common/utils"
import {StatApp} from "../../StatApp"
import {registerProcessHook, sleep} from "../tool/ProcessTool"
import {createDB, getSlaveStatus, initModel} from "../DBProvider"
import {doHeartBeat, KEY_PRUNE} from "../../model/HeartBeat"

const lodash = require('lodash');

export class PruneService {
    private readonly app
    private readonly opts
    private KEEP_ROWS = 20000
    private sbmLastTime = 0
    private sbmAlertTimes = 0
    private pruneCfg = {
        pruneEpochsPerTime: 100,
        delRowsPerLoop: 500,
        sleepMsPerLoop: 20,
        delayEpochsAgainstLatest: 1000,
    }

    public constructor(app, opts?: any) {
        this.app = app
        this.opts = opts
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
            setTimeout(repeat, delay)
        }
        repeat().then()
        console.log(`schedule prune service in ${delay/1000}s interval`)
    }

    private async getConfig(){
        const {sequelize} = this.app

        let [pruneEpochsPerTime, delRowsPerLoop, sleepMsPerLoop, delayEpochsAgainstLatest] = await Promise.all([
            KV.getNumber(KEY_PRUNE_EPOCHS_PER_TIME, this.pruneCfg.pruneEpochsPerTime),
            KV.getNumber(KEY_PRUNE_DEL_ROWS_PER_LOOP, this.pruneCfg.delRowsPerLoop),
            KV.getNumber(KEY_PRUNE_SLEEP_MS_PER_LOOP, this.pruneCfg.sleepMsPerLoop),
            KV.getNumber(KEY_PRUNE_DELAY_EPOCHS_AGAINST_LATEST, this.pruneCfg.delayEpochsAgainstLatest),
        ])

        // Adjust the parameter `delRowsPerLoop` according to the `Seconds_Behind_Master` status of MySQL.
        // If sbm is greater than 200 for three consecutive minutes and is greater than the previous value,
        // subtract 50 from delRowsPerLoop.
        const status = await getSlaveStatus(sequelize) as any
        const sbm = status?.Seconds_Behind_Master
        if(lodash.isNumber(sbm)) {
            if(sbm > 200 && this.sbmLastTime > 200 && (sbm - this.sbmLastTime) > 0) {
                this.sbmAlertTimes ++
            }
            this.sbmLastTime = sbm
        }
        if(this.sbmAlertTimes >= 3) {
            delRowsPerLoop -= 50
            this.sbmAlertTimes = 0
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
        const epochBlock: number = await FullBlock.max('epoch')

        if(epochs.maxEpoch <= epochBlock - this.pruneCfg.delayEpochsAgainstLatest){
            const sql = `select distinct(minerId) from ${FullBlock.getTableName()} where epoch >= :minEpoch and epoch <= :maxEpoch`
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
        const epochBlock: number = await FullBlock.max('epoch')
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
    }

    private async pruneAddress(addressId, type, maxEpoch?) {
        const {config} = this.app

        const [_, model] = this.getTables(type)
        const one = await (model as any).findOne({
            where: {addressId}, order: [["epoch", "desc"]], offset: this.KEEP_ROWS, limit: 1, raw: true
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
                    where: {addressId, epoch: {[Op.lt]: one.epoch}}, limit: this.pruneCfg.delRowsPerLoop})
                if (del) {
                    pruned += del
                    await PruneInfo.update({pruned, epoch: one.epoch}, {
                        transaction: dbTx, where: {id: prune.id}})
                }
            })

            this.pruneCfg.sleepMsPerLoop && await sleep(this.pruneCfg.sleepMsPerLoop)
            await doHeartBeat(KEY_PRUNE+config.serverTag)
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
                \runion 
                \rselect distinct(toId) as id from ${fullModel.getTableName()} where epoch >= :minEpoch and epoch <= :maxEpoch`
    }

    public async close() {
        await KV.sequelize.close();
    }
}

let table // 1-prune address from prune_info, 2-prune address_transfer, 3-prune all tables
let skipPrunedEpoch = 1 // skip if max epoch is less than pruned epoch, 1-skip, 0-not skip
let type // only used for table = 'prune_info', refer to PruneType, it will prune all type if pruneType is not set

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

    const cfx = await initCfxSdk(config.conflux)
    StatApp.networkId = cfx.networkId

    const app = {cfx, config, sequelize}
    const srv = new PruneService(app, opts)
    await srv.refreshConfig()
    await srv.run()

    registerProcessHook(srv)
}

// node script prune_info       [skipPrunedEpoch] [pruneType] # prune by prune_info, it needs provide param `skipPrunedEpoch` if use param `pruneType`
// node script address_transfer [skipPrunedEpoch]             # prune address_transfer
// node script all              [skipPrunedEpoch]             # prune all tables
if (module === require.main) {
    const args = process.argv.slice(2)
    if(args[0]) {
        table = args[0]
    }
    if(args[1]) {
        skipPrunedEpoch = Number(args[1])
    }
    if(table === 'prune_info' && args[2]) {
        type = args[2]
    }
    start({table, skipPrunedEpoch, type}).then()
}