import {DataTypes, Model, Transaction, QueryTypes} from "sequelize";
import {Cfg_is_EVM} from "../config/StatConfig";

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
export const VERIFIED_COUNT_ALL = "VERIFIED_COUNT_ALL"
export const VERIFIED_COUNT_ID = "VERIFIED_COUNT_ID"
export const TOTAL_POS_REWARD = "TOTAL_POS_REWARD"
export const IS_EVM2 = "IS_EVM2"
export const TRACE_CONTRACT_TOKEN_ID = "TRACE_CONTRACT_TOKEN_ID"
export const API_LOG_RT_LIMIT = 'API_LOG_RT_LIMIT';
export const USE_REMOTE_STAT = 'USE_REMOTE_STAT';
export const KEY_FULL_CFX_TRANSFER_COUNT = "FULL_CFX_TRANSFER_COUNT_2"
export const KEY_FILL_BLOCK_PROPS_EPOCH = "KEY_FILL_BLOCK_PROPS_EPOCH"
export const KEY_FILL_BLOCK_REWARD_EPOCH = "KEY_FILL_BLOCK_REWARD_EPOCH"
export const KEY_TX_EPOCH = "KEY_TX_EPOCH"
export const KEY_1155data_EPOCH = "KEY_1155data_EPOCH"
export const KEY_history1155amount_EPOCH = "history1155amount_EPOCH"
export const ERC20_TRANSFER_DELAY = "ERC20_TRANSFER_DELAY"
export const CFX_TRANSFER_DELAY = "CFX_TRANSFER_DELAY"
export const INTERNAL_IP_BLOCK = "INTERNAL_IP_BLOCK";
export const KEY_NFT_FROM_DB = "SWITCH_NFT_FROM_DB"
export const NFT_META_POS_EPOCH = "NFT_META_POS_EPOCH"
export const KEY_NFT_FROM_MINT_TABLE = "SWITCH_NFT_FROM_MINT_TABLE"
export const KEY_TOKEN_TRANSFER_PER_SECOND = "KEY_TOKEN_TRANSFER_PER_SECOND"
export const KEY_GAS_USED_PER_SECOND = "KEY_GAS_USED_PER_SECOND"
export const KEY_GAS_PRICE_TRACKER = "KEY_GAS_PRICE_TRACKER"
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
export const KEY_STAT_TXNS_FOR_VERIFIED_CONTRACTS = 'KEY_STAT_TXNS_FOR_VERIFIED_CONTRACTS'
export const KEY_STAT_ANNOUNCE_NAME_FOR_VERIFIED_CONTRACTS = 'KEY_STAT_ANNOUNCE_NAME_FOR_VERIFIED_CONTRACTS'
export const KEY_STAT_NAME_TAG_FOR_VERIFIED_CONTRACTS = 'KEY_STAT_NAME_TAG_FOR_VERIFIED_CONTRACTS'

export const KEY_OPEN_API_URL = "OPEN_API_URL"
export const KEY_CORE_OPEN_API_URL = "CORE_OPEN_API_URL"
export const KEY_CORE_API_URL = "CORE_API_URL"
export const KEY_CONFURA_URL = "CONFURA_URL"
export const EVM_RPC_URL = "EVM_RPC_URL"

export const KEY_FASTEST_IPFS_GATEWAY = "KEY_FASTEST_IPFS_GATEWAY"
export const KEY_CENSOR_CALL_COUNT = "KEY_CENSOR_CALL_COUNT"
export const KEY_CAUTION_LABELS = "KEY_CAUTION_LABELS"
export const KEY_OFFICIAL_LABELS = "KEY_OFFICIAL_LABELS"
export const KEY_EVM_VERSIONS = "KEY_EVM_VERSIONS"
export const UNIFORM_APPROVAL_EPOCH = "UNIFORM_APPROVAL_EPOCH"
export const KEY_EPOCH_CIP1559_ENABLED = "EPOCH_CIP1559_ENABLED"
export const KEY_SUPRESS_FULLSTATE_RPC_ERR = "SUPRESS_FULLSTATE_RPC_ERR"
export const KEY_EVICTED_STAT_BLOCK_DATA = "EVICTED_STAT_BLOCK_DATA"
export const KEY_AUTO_VERIFY_TRACE_ID = "AUTO_VERIFY_TRACE_ID"
export const KEY_AUTO_VERIFY_VERIFY_ID = "AUTO_VERIFY_VERIFY_ID"
export const KEY_SOLC_VERSIONS = "SOLC_VERSIONS"
export const KEY_VYPER_VERSIONS = "VYPER_VERSIONS"
export const KEY_BLACKLIST_DISABLE = "BLACKLIST_DISABLE"

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
    static async saveNumber(key:string, value:any, dbTx?:Transaction) {
        return KV.upsert({key, value: value.toString()}, {transaction: dbTx})
    }
    static async getSwitch(key: string): Promise<boolean> {
        if (key === IS_EVM2) {
            if (Cfg_is_EVM != null) { //  null == undefined --> true
                return Cfg_is_EVM;
            }
        }
        const str = (await KV.findOne({where: {key}}) || {}).value
        return Promise.resolve((str || '').toLowerCase() === 'true')
    }

    static register(sequelize) {
        KV.init({
            key: {type: DataTypes.CHAR(64), primaryKey: true},
            value: DataTypes.STRING(8192)
        }, {
            sequelize,
            tableName: 'config',
            timestamps: false
        })
    }
}

export async function diffCount(key:string, diff:number, dbTx:Transaction) {
    const sql = "update config set `value` = ? + cast(`value` as unsigned) where `key`=?"
    return KV.sequelize.query(sql,
        {type: QueryTypes.UPDATE, replacements: [diff, key],
            transaction: dbTx})
}
