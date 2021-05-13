import {DataTypes, Model} from "sequelize";

export interface IKV {
    key: string;
    value: string
}
export const KEY_FULL_BLOCK_COUNT = "FULL_BLOCK_COUNT"
export const KEY_FULL_TX_COUNT = "FULL_TX_COUNT"
export const KEY_FILL_BLOCK_PROPS_EPOCH = "KEY_FILL_BLOCK_PROPS_EPOCH"
export const KEY_FILL_BLOCK_REWARD_EPOCH = "KEY_FILL_BLOCK_REWARD_EPOCH"
export const KEY_MINER_EPOCH = "KEY_MINER_EPOCH"
export const KEY_TX_EPOCH = "KEY_TX_EPOCH"
export const KEY_BLOCK_TRACE_TX_ID = "KEY_BLOCK_TRACE_TX_ID"
export const KEY_BLOCK_TRACE_CREATE_EPOCH = "KEY_BLOCK_TRACE_CREATE_EPOCH"
export const KEY_BALANCE_POS_PREFIX = "BALANCE_POS_"
export const KEY_NFT_TOKEN_ID_POS = "NFT_TOKEN_ID_POS_"

export class KV extends Model<IKV> implements IKV {
    key: string;
    value: string;

    static async getNumber(key: string): Promise<number> {
        const str = (await KV.findOne({where: {key}}) || {}).value
        if (str === null) {
            return Promise.resolve(null);
        }
        return Promise.resolve(parseInt(str))
    }

    static register(sequelize) {
        KV.init({
            key: {type: DataTypes.CHAR(30), primaryKey: true},
            value: DataTypes.CHAR(128)
        }, {
            sequelize,
            tableName: 'config',
            timestamps: false
        })
    }
}