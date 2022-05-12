import {DataTypes, Model, Transaction, Sequelize, UniqueConstraintError} from "sequelize";

export interface IKV {
    key: string;
    value: string
}
export const SCAN_UTIL_CONTRACT = 'SCAN_UTIL_CONTRACT'
export const ANNOUNCEMENT_CONTRACT = 'ANNOUNCEMENT_CONTRACT'
export const KEY_FULL_BLOCK_COUNT = "FULL_BLOCK_COUNT"
export const KEY_FULL_TX_COUNT = "FULL_TX_COUNT"
export const TOTAL_POS_REWARD = "TOTAL_POS_REWARD"
export const IS_EVM = "IS_EVM"
export const IS_EVM2 = "IS_EVM2"
export const ENS_SEARCH_TEXT_CURSOR = 'ENS_SEARCH_TEXT_CURSOR'
export const KEY_FULL_CFX_TRANSFER_COUNT = "FULL_CFX_TRANSFER_COUNT_2"
export const KEY_FILL_BLOCK_PROPS_EPOCH = "KEY_FILL_BLOCK_PROPS_EPOCH"
export const KEY_FILL_BLOCK_REWARD_EPOCH = "KEY_FILL_BLOCK_REWARD_EPOCH"
export const KEY_TX_EPOCH = "KEY_TX_EPOCH"
export const KEY_1155data_EPOCH = "KEY_1155data_EPOCH"
export const ERC20_TRANSFER_DELAY = "ERC20_TRANSFER_DELAY"
export const CFX_TRANSFER_DELAY = "CFX_TRANSFER_DELAY"
export const KEY_BLOCK_TRACE_TX_ID = "KEY_BLOCK_TRACE_TX_ID"
export const KEY_BLOCK_TRACE_CREATE_EPOCH = "KEY_BLOCK_TRACE_CREATE_EPOCH"
export const KEY_ANNOUNCE_SYNC_EPOCH = "KEY_ANNOUNCE_SYNC_EPOCH"
export const KEY_TOKEN_AUTO_DETECT_EPOCH = "KEY_TOKEN_AUTO_DETECT_EPOCH"
export const KEY_NFT_TOKEN_ID_POS = "NFT_TOKEN_ID_POS_"
export const KEY_EPOCH_QUERY_RDB_SWITCH = "SWITCH_EPOCH_QUERY_RDB"
export const KEY_BLOCK_QUERY_RDB_SWITCH = "SWITCH_BLOCK_QUERY_RDB"
export const KEY_TX_QUERY_RDB_SWITCH = "SWITCH_TX_QUERY_RDB"
export const KEY_TRANSFER_QUERY_RDB_SWITCH = "SWITCH_TRANSFER_QUERY_RDB"
export const KEY_CONTRACT_QUERY_RDB_SWITCH = "SWITCH_CONTRACT_QUERY_RDB"
export const KEY_ANNOUNCE_QUERY_RDB_SWITCH = "SWITCH_ANNOUNCE_QUERY_RDB"
export const KEY_EVENT_LOG_QUERY_RDB_SWITCH = "SWITCH_EVENT_LOG_QUERY_RDB"
export const KEY_BLOCK_DATA_STAT_RDB_SWITCH = "SWITCH_BLOCK_DATA_STAT_QUERY_RDB"
export const KEY_TOKEN_SYNC_BY_SCAN_SWITCH = "SWITCH_TOKEN_SYNC_BY_SCAN"
export const KEY_NFT_FROM_DB = "SWITCH_NFT_FROM_DB"
export const KEY_NFT_FROM_MINT_TABLE = "SWITCH_NFT_FROM_MINT_TABLE"
export const KEY_TPS_TRANSFER = "KEY_TPS_TRANSFER"
export const KEY_TPS_TRANSFER_NOTIFY = "KEY_TPS_TRANSFER_NOTIFY"
export const CFX_BILL_EPOCH = "CFX_BILL_EPOCH"
export const CFX_BILL_EPOCH_3 = "CFX_BILL_EPOCH_3"
export const CFX_BILL_POS_EPOCH_REWARD = "CFX_BILL_POS_EPOCH_REWARD"
export const CFX_BILL_POS_EPOCH_REWARD_3 = "CFX_BILL_POS_EPOCH_REWARD_3"
export const KEY_PRUNE_CONFIG_SWITCH = "KEY_PRUNE_CONFIG_SWITCH"
export const KEY_PRUNE_LOOP = "KEY_PRUNE_LOOP"
export const KEY_PRUNE_DEL_ROWS_PER_LOOP = "KEY_PRUNE_DEL_ROWS_PER_LOOP"
export const KEY_PRUNE_SLEEP_MS_PER_LOOP = "KEY_PRUNE_SLEEP_MS_PER_LOOP"
export const KEY_PRUNE_NOTIFY_INTERVAL = "KEY_PRUNE_NOTIFY_INTERVAL"

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
            value: DataTypes.CHAR(255)
        }, {
            sequelize,
            tableName: 'config',
            timestamps: false
        })
    }

    static async setupSwitch() {
        const anyOne = await KV.findOne({where: {key: KEY_TX_QUERY_RDB_SWITCH}})
        if (anyOne) {
            return
        }
        await KV.bulkCreate([
            {key: SCAN_UTIL_CONTRACT, value: ''},
            {key: ANNOUNCEMENT_CONTRACT, value: ''},
            {key: KEY_ANNOUNCE_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_BLOCK_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_CONTRACT_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_EPOCH_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_TRANSFER_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_TX_QUERY_RDB_SWITCH, value: 'true'},
            {key: KEY_BLOCK_DATA_STAT_RDB_SWITCH, value: 'true'},
            {key: KEY_EVENT_LOG_QUERY_RDB_SWITCH, value: 'true'},
        ]);
    }

    static async diffCount(key:string, diff:number, dbTx:Transaction, logger = undefined): Promise<[number, number]> {
        const oldValue = await KV.getNumber(key);
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
