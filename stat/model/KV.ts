import {DataTypes, Model, Transaction, Sequelize, UniqueConstraintError} from "sequelize";

export interface IKV {
    key: string;
    value: string
}
export const SCAN_UTIL_CONTRACT = 'SCAN_UTIL_CONTRACT'
export const CONTRACT_ANNOUNCEMENT = 'CONTRACT_ANNOUNCEMENT'
export const CONTRACT_ADDRESS_METADATA = 'CONTRACT_ADDRESS_METADATA'
export const KEY_FULL_BLOCK_COUNT = "FULL_BLOCK_COUNT"
export const KEY_FULL_TX_COUNT = "FULL_TX_COUNT"
export const ADDRESS_COUNT_ALL = "ADDRESS_COUNT_ALL"
export const ADDRESS_COUNT_ID = "ADDRESS_COUNT_ID"
export const CONTRACT_COUNT_ALL = "CONTRACT_COUNT_ALL"
export const CONTRACT_COUNT_ID = "CONTRACT_COUNT_ID"
export const TOTAL_POS_REWARD = "TOTAL_POS_REWARD"
export const IS_EVM2 = "IS_EVM2"
export const API_LOG_RT_LIMIT = 'API_LOG_RT_LIMIT';
export const USE_REMOTE_STAT = 'USE_REMOTE_STAT';
export const ENS_SEARCH_TEXT_CURSOR = 'ENS_SEARCH_TEXT_CURSOR'
export const KEY_FULL_CFX_TRANSFER_COUNT = "FULL_CFX_TRANSFER_COUNT_2"
export const KEY_FILL_BLOCK_PROPS_EPOCH = "KEY_FILL_BLOCK_PROPS_EPOCH"
export const KEY_FILL_BLOCK_REWARD_EPOCH = "KEY_FILL_BLOCK_REWARD_EPOCH"
export const KEY_TX_EPOCH = "KEY_TX_EPOCH"
export const KEY_1155data_EPOCH = "KEY_1155data_EPOCH"
export const KEY_history1155amount_EPOCH = "history1155amount_EPOCH"
export const ERC20_TRANSFER_DELAY = "ERC20_TRANSFER_DELAY"
export const CFX_TRANSFER_DELAY = "CFX_TRANSFER_DELAY"
export const KEY_NFT_FROM_DB = "SWITCH_NFT_FROM_DB"
export const NFT_META_POS_EPOCH = "NFT_META_POS_EPOCH"
export const KEY_NFT_FROM_MINT_TABLE = "SWITCH_NFT_FROM_MINT_TABLE"
export const KEY_TOKEN_TRANSFER_PER_SECOND = "KEY_TOKEN_TRANSFER_PER_SECOND"
export const KEY_GAS_USED_PER_SECOND = "KEY_GAS_USED_PER_SECOND"
export const KEY_GAS_PRICE_TRACKER = "KEY_GAS_PRICE_TRACKER"
export const KEY_GAS_USED_PER_SECOND_NOTIFY = "KEY_GAS_USED_PER_SECOND_NOTIFY"
export const CFX_BILL_EPOCH_3 = "CFX_BILL_EPOCH_3"
export const CFX_BILL_POS_EPOCH_REWARD_3 = "CFX_BILL_POS_EPOCH_REWARD_3"
export const KEY_FULL_STATE_RPC = "KEY_FULL_STATE_RPC"

export const KEY_PRUNE_EPOCHS_PER_TIME = "KEY_PRUNE_EPOCHS_PER_TIME"
export const KEY_PRUNE_DEL_ROWS_PER_LOOP = "KEY_PRUNE_DEL_ROWS_PER_LOOP"
export const KEY_PRUNE_SLEEP_MS_PER_LOOP = "KEY_PRUNE_SLEEP_MS_PER_LOOP"
export const KEY_PRUNE_DELAY_EPOCHS_AGAINST_LATEST = "KEY_PRUNE_DELAY_EPOCHS_AGAINST_LATEST"
export const KEY_PRUNE_ADJUST_BY_SBM = "KEY_PRUNE_ADJUST_BY_SBM"
export const KEY_PRUNE_EPOCH_BLOCK = 'KEY_PRUNE_EPOCH_BLOCK'
export const KEY_PRUNE_EPOCH_CFX_TRANSFER = 'KEY_PRUNE_EPOCH_CFX_TRANSFER'
export const KEY_PRUNE_EPOCH_TOKEN_TRANSFER = 'KEY_PRUNE_EPOCH_TOKEN_TRANSFER'
export const KEY_PRUNE_EPOCH_ADDR_TRANSFER = 'KEY_PRUNE_EPOCH_ADDR_TRANSFER'

export const KEY_OPEN_API_URL = "OPEN_API_URL"
export const KEY_CORE_OPEN_API_URL = "CORE_OPEN_API_URL"
export const KEY_CORE_API_URL = "CORE_API_URL"
export const KEY_CONFURA_URL = "CONFURA_URL"

export const KEY_FASTEST_IPFS_GATEWAY = "KEY_FASTEST_IPFS_GATEWAY"
export const KEY_CENSOR_CALL_COUNT = "KEY_CENSOR_CALL_COUNT"
export const KEY_CAUTION_LABELS = "KEY_CAUTION_LABELS"
export const KEY_EVM_VERSIONS = "KEY_EVM_VERSIONS"
export const KEY_BN_CIP1559_ENABLED = "BN_CIP1559_ENABLED"

export class KV extends Model<IKV> implements IKV {
    key: string;
    value: string;

    static async getString(key:string, defaultV:string) {
        const str = (await KV.findOne({where: {key}}) || {}).value || defaultV
        return str
    }

    static async getNumber(key: string, defaultV = null): Promise<number> {
        const str = (await KV.findOne({where: {key}}) || {}).value
        if (!str) {
            return Promise.resolve(defaultV);
        }
        return Promise.resolve(parseInt(str))
    }
    static async saveNumber(key:string, value:any, dbTx:Transaction) {
        return KV.upsert({key, value: value.toString()}, {transaction: dbTx})
    }
    static async getSwitch(key: string): Promise<boolean> {
        const str = (await KV.findOne({where: {key}}) || {}).value
        return Promise.resolve((str || '').toLowerCase() === 'true')
    }

    static register(sequelize) {
        KV.init({
            key: {type: DataTypes.CHAR(64), primaryKey: true},
            value: DataTypes.STRING(1024)
        }, {
            sequelize,
            tableName: 'config',
            timestamps: false
        })
    }

    static async setupSwitch() {
/*        const anyOne = await KV.findOne({where: {key: KEY_TX_QUERY_RDB_SWITCH}})
        if (anyOne) {
            return
        }
        await KV.bulkCreate([
            {key: SCAN_UTIL_CONTRACT, value: ''},
            {key: CONTRACT_ANNOUNCEMENT, value: ''},
            {key: KEY_ANNOUNCE_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_BLOCK_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_CONTRACT_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_EPOCH_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_TRANSFER_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_TX_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_BLOCK_DATA_STAT_RDB_SWITCH, value: 'true'},
            {key: KEY_EVENT_LOG_QUERY_RDB_SWITCH, value: 'true'},
        ]);*/
    }

    static async diffCount(key:string, diff:number, dbTx:Transaction, logger = undefined): Promise<[number, number]> {
        const oldValue = await KV.getNumber(key, NaN);
        if(isNaN(oldValue)) throw new Error(`no key:${key} in KV`);

        const newValue = oldValue + diff;
        await KV.update({value: newValue.toString()}, {where:{key:key}, transaction: dbTx});
        // logger?.info(`batchSaveCfxTransfer-0----------------------dbValue+diff:${dbValue+diff},----resultArray:${JSON.stringify(resultArray)}`);
        return Promise.resolve([oldValue, newValue]);
    }
}

export interface IPosition {
    tag:string
    pos:number
    active:boolean
}
export const POS_CFX_BILL = 'POS_CFX_BILL'
export class Position extends Model<IPosition> implements IPosition {
    tag:string
    pos:number
    active: boolean
    static register(seq:Sequelize) {
        Position.init({
            tag: {type: DataTypes.STRING(32), unique: true, primaryKey: true},
            pos: {type: DataTypes.BIGINT({unsigned: true})},
            active: {type: DataTypes.BOOLEAN, defaultValue: true},
        },{
            sequelize: seq,
            tableName: 'Positions'
        })
    }

    public static async getPosDefault(tag: string, v: number) {
        return this.getPosition(tag).then(res=>{
            return res ? res.pos : v
        })
    }
    static async getPosition(tag:string) : Promise<Position> {
        return Position.findByPk(tag)
    }
    static async setPosition(tag:string, pos:number) {
        return Position.update({pos}, {where:{tag}, limit: 1})
            .then(([cnt])=>{
            if (cnt === 0) {
                return Position.create({tag, pos, active: true}).catch(err=>{
                    if (err instanceof UniqueConstraintError){
                        // when pos is not changed ?
                    } else {
                        throw err
                    }
                })
            }
        })
    }
}
