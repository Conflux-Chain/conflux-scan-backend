import {DataTypes, Model, QueryTypes, Sequelize} from "sequelize";

/**
 * list block mined by miner
 */
export interface IFullMinerBlock {
    minerId: number;
    epoch: number;
    position: number;
    createdAt: Date,
}

const T_FULL_MINER_BLOCK = 'full_miner_block';
const T_FULL_MINER_BLOCK_SQL = `
create table if not exists ${T_FULL_MINER_BLOCK}
(
\t \`minerId\` bigint(20) unsigned NOT NULL,
\t \`epoch\` bigint(20) unsigned NOT NULL,
\t \`position\` smallint(6) NOT NULL DEFAULT '0',
\t \`createdAt\` datetime NOT NULL,
  PRIMARY KEY (\`minerId\` DESC, \`epoch\` DESC, \`position\` DESC),
  KEY \`block_time_idx\` (\`createdAt\` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8
partition by hash (addressId)
  PARTITIONS 199;
`

export async function createFullMinerBlockTable(seq:Sequelize) {
    return seq.query(T_FULL_MINER_BLOCK_SQL,{
        type:QueryTypes.UPDATE
    }).then(()=>{
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
    createdAt: Date;

    static register(sequelize) {
        FullMinerBlock.init({
                minerId: DataTypes.BIGINT,
                epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
                position: {type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0}, // A 16 bit integer.
                createdAt: {type: DataTypes.DATE, allowNull: false},
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
