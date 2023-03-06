import {DataTypes, Model, Sequelize} from "sequelize";
import {createTable} from "../service/DBProvider";

export const T_NFT_TRANSFER = "nft_transfer"

export interface INftTransfer {
    id?: number
    epoch: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    batchIndex: number

    fromId: number
    toId: number
    contractId: number
    tokenId: string
    value: string

    type: number
    createdAt: Date
}

export class NftTransfer extends Model<INftTransfer> implements INftTransfer {
    id?: number
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
    createdAt:Date

    static register(seq:Sequelize) {
        NftTransfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txLogIndex: {type: DataTypes.SMALLINT, allowNull: false},
            batchIndex: {type: DataTypes.SMALLINT, allowNull: false},

            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},

            type: {type: DataTypes.SMALLINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
        },{
            sequelize: seq,
            tableName: T_NFT_TRANSFER,
            updatedAt: false,
            indexes: [
                {
                    name: 'idx_contractId_epoch',
                    fields: ['contractId','epoch']
                },
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
                {
                    name: 'idx_createdAt',
                    fields: [{name: 'createdAt', order: "DESC"}]
                },
            ],
        })
    }
}

//=================
export const T_ADDRESS_NFT_TRANSFER = "address_nft_transfer"

const T_ADDRESS_NFT_TRANSFER_SQL = `
CREATE TABLE IF NOT EXISTS ${T_ADDRESS_NFT_TRANSFER}
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
  \`createdAt\` datetime NOT NULL,
  PRIMARY KEY  (addressId DESC,epoch DESC,blockIndex DESC, txIndex DESC, txLogIndex DESC, batchIndex DESC, type DESC),
  KEY \`idx_epoch\` (\`epoch\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY HASH (addressId)
   PARTITIONS 97;
`
export async function createAddressNftTransferTable(seq:Sequelize) {
    return createTable(seq, T_ADDRESS_NFT_TRANSFER_SQL).then(()=>{
        return AddressNftTransfer.register(seq)
    }).then(()=>{
        AddressNftTransfer.removeAttribute("id")
    }).catch(err=>{
        console.log(`createAddressNftTransferTable fail, sql ${T_ADDRESS_NFT_TRANSFER_SQL}:`, err)
        process.exit(9)
    })
}

export interface IAddressNftTransfer {
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
    createdAt: Date
}

export class AddressNftTransfer extends Model<IAddressNftTransfer> implements IAddressNftTransfer {
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
    createdAt: Date
    static register(seq: Sequelize) {
        AddressNftTransfer.init({
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
            createdAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_NFT_TRANSFER,
            indexes: [
            ],
        })
    }
}