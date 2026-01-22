import {DataTypes, Model, Sequelize} from "sequelize";
import {createTable} from "../service/DBProvider";
import {IBaseBlock} from "./FullBlock";

/**
 * list block mined by miner
 */
export interface IFullMinerBlock extends IBaseBlock {
}

const T_FULL_MINER_BLOCK = 'full_miner_block';
const T_FULL_MINER_BLOCK_SQL = `
create table if not exists ${T_FULL_MINER_BLOCK}
(
\t \`minerId\` bigint(20) unsigned NOT NULL,
\t \`epoch\` bigint(20) unsigned NOT NULL,
\t \`position\` smallint(6) NOT NULL DEFAULT '0',
    'hash' char(66) CHARACTER SET ascii,
   
   \`avgGasPrice\` decimal(36, 0) NOT NULL DEFAULT '0',
   \`txCount\`          int NOT NULL DEFAULT '0',
   \`executedTxnCount\` int NOT NULL DEFAULT '0',
   \`gasLimit\`    decimal(36, 0) NOT NULL DEFAULT '0',
   \`totalReward\` decimal(36, 0) NOT NULL DEFAULT '0',
   \`gasUsed\` decimal(36, 0) NOT NULL DEFAULT '0',
    
\t \`createdAt\` datetime NOT NULL,
  PRIMARY KEY (\`minerId\` DESC, \`epoch\` DESC, \`position\` DESC),
  KEY \`block_time_idx\` (\`createdAt\` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8
partition by hash (minerId)
  PARTITIONS 199;
`

export async function createFullMinerBlockTable(seq:Sequelize) {
    return createTable(seq, T_FULL_MINER_BLOCK_SQL)
    .then(()=>{
        return FullMinerBlock.register(seq)
    }).then(()=>{
        FullMinerBlock.removeAttribute("id")
    }).catch(err=>{
        console.log(`createFullMinerBlockTable fail, sql ${T_FULL_MINER_BLOCK_SQL}:`, err)
        process.exit(9)
    })
}

export class FullMinerBlock extends Model<IFullMinerBlock> implements IFullMinerBlock {
    minerId: number;
    epoch: number;
    position: number;
    avgGasPrice: bigint;
    gasUsed:number;
    txCount:number;
    executedTxnCount:number;
    gasLimit: number;
    totalReward: bigint;

    hash: string;
    createdAt: Date;

    static register(sequelize) {
        FullMinerBlock.init({
                minerId: DataTypes.BIGINT,
                epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
                position: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16-bits integer.
                hash: {type: DataTypes.STRING(66), allowNull: false, charset: 'ascii',} as any,
                createdAt: {type: DataTypes.DATE, allowNull: false},

                txCount: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0}, // A 32-bits integer.
                executedTxnCount: {type: DataTypes.INTEGER, allowNull: true, defaultValue: 0}, // A 32-bit integer.
                totalReward: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
                avgGasPrice: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0}, // sum(gasPrice of tx) / txCount
                gasLimit: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
                gasUsed: {type: DataTypes.DECIMAL(36,0), allowNull: false, defaultValue: 0},
            }
            , {
                timestamps: false,
                sequelize: sequelize,
                tableName: 'full_miner_block',
                indexes: [
                    {
                        name: 'block_time_idx', // index name must be unique globally under sqlite.
                        fields: [{name: 'createdAt', order: 'DESC'}]
                    },
                    /*{
                    // It's primary key, created by SQL directly.
                        name: 'pk_minerId_epoch_bPos', unique: true,
                        fields:[
                            {name:'minerId', order: 'DESC'},
                            {name:'epoch', order: 'DESC'},
                            {name:'position', order: 'DESC'},
                        ],
                    }*/
                ]
            })
    }
}

export function buildFullMinerBlock(list:any[]) : IFullMinerBlock[] {
    const result : any[] = []
    let idx =
    list.forEach(row=>{
        const minerBlock = {
            minerId: row.minerId,
            epoch: row.epoch,
            position: row.position,
            createdAt: row.createdAt
        };
        result.push(minerBlock)
    })
    return result
}
