import {Sequelize, DataTypes, Model} from "sequelize";
import {createTable} from "../service/DBProvider";

//=================
export const T_ADDRESS_TRANSFER = "address_transfer"

const T_ADDRESS_TRANSFER_SQL = `
CREATE TABLE IF NOT EXISTS ${T_ADDRESS_TRANSFER}
(
  \`addressId\` bigint(20) NOT NULL,
  \`epoch\` bigint(20) NOT NULL,
  \`blockIndex\` smallint(6) unsigned NOT NULL,
  \`txIndex\` smallint(6) unsigned NOT NULL,
  \`txLogIndex\` smallint(6) unsigned NOT NULL,
  \`batchIndex\` smallint(6) unsigned NOT NULL,
  \`fromId\` bigint(20) NOT NULL,
  \`toId\` bigint(20) NOT NULL,
  \`contractId\` bigint(20) NULL,
  \`tokenId\` varchar(78) NULL,
  \`value\` varchar(78) NOT NULL,
  \`type\` smallint(6) NOT NULL,
  \`cursorId\` decimal(65, 0) default NULL,
  \`createdAt\` datetime NOT NULL,
  PRIMARY KEY  (addressId DESC,epoch DESC,blockIndex DESC, txIndex DESC, txLogIndex DESC, batchIndex DESC, type DESC),
  KEY \`from_idx\` (\`epoch\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY HASH (addressId)
   PARTITIONS 97;
`
export async function createAddressTransferTable(seq:Sequelize) {
    return createTable(seq, T_ADDRESS_TRANSFER_SQL).then(()=>{
        return AddressTransfer.register(seq)
    }).then(()=>{
        AddressTransfer.removeAttribute("id")
    }).catch(err=>{
        console.log(`createAddressTransferTable fail, sql ${T_ADDRESS_TRANSFER_SQL}:`, err)
        process.exit(9)
    })
}

export interface IAddressTransfer {
    addressId: number

    epoch: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    batchIndex: number

    fromId: number
    toId: number
    contractId: number
    tokenId:string
    value: string

    type: number
    cursorId: number
    createdAt: Date
}

export class AddressTransfer extends Model<IAddressTransfer> implements IAddressTransfer {
    addressId: number

    epoch: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    batchIndex: number

    fromId: number
    toId: number
    contractId: number
    tokenId:string
    value: string

    type: number
    cursorId: number
    createdAt: Date
    static register(seq: Sequelize) {
        AddressTransfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},

            epoch: {type: DataTypes.BIGINT, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txLogIndex: {type: DataTypes.SMALLINT, allowNull: false},
            batchIndex: {type: DataTypes.SMALLINT, allowNull: false},

            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: true},
            value: {type: DataTypes.STRING(78), allowNull: false},

            type: {type: DataTypes.SMALLINT, allowNull: false},
            cursorId: {type: DataTypes.DECIMAL(65, 0), allowNull: true, },
            createdAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_TRANSFER,
            indexes: [
            ],
        })
    }
}
