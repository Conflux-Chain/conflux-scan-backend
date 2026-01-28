import {QueryTypes, Op, Sequelize, Transaction, DataTypes, Model} from "sequelize";
import {makeId} from "./HexMap";
import {popPartition} from "./ErcTransfer";
import {createTable} from "../service/DBProvider";
import {Erc20Transfer, ITokenTransfer} from "./Erc20Transfer";

//=================
export interface IAddressErc1155Transfer extends ITokenTransfer{
    addressId: number
    value: string
    tokenId:string
    batchIndex: number
}

export const T_ADDRESS_ERC1155_TRANSFER = "address_erc1155transfer_3"
const T_ADDRESS_ERC1155_TRANSFER_SQL = `
create table if not exists ${T_ADDRESS_ERC1155_TRANSFER}
(
\t addressId bigint not null,
\t epoch bigint not null,
\t createdAt datetime not null,
  \`blockIndex\` int unsigned NOT NULL,
  \`txIndex\` mediumint unsigned NOT NULL,
\`txLogIndex\` mediumint unsigned NOT NULL,
\`batchIndex\` mediumint unsigned NOT NULL,
   tx char(66)  character set 'ascii' not null,
\t contractId bigint not null,
\t fromId bigint not null,
\t toId bigint not null,
\t \`value\` decimal(36) not null,
\t tokenId varchar(78) null,
    primary key  (addressId desc,epoch desc,blockIndex desc, 
    txIndex desc, txLogIndex desc, batchIndex desc),
    KEY idx_addr_epoch ( addressId, epoch desc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by hash (addressId)
   PARTITIONS 23;
`
export async function createAddressErc1155TransferTable(seq:Sequelize) {
    return createTable(seq, T_ADDRESS_ERC1155_TRANSFER_SQL).then(()=>{
        return AddressErc1155Transfer.register(seq)
    }).then(()=>{
        AddressErc1155Transfer.removeAttribute("id")
    }).catch(err=>{
        console.log(`createAddressErc1155TransferTable fail, sql ${T_ADDRESS_ERC1155_TRANSFER_SQL}:`, err)
        process.exit(9)
    })
}
export class AddressErc1155Transfer extends Model<IAddressErc1155Transfer> implements IAddressErc1155Transfer {
    addressId: number
    epoch: number
    createdAt: Date
    contractId: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    batchIndex: number
    tx: string
    fromId: number
    toId: number
    value: string
    tokenId:string
    static register(seq: Sequelize) {
        AddressErc1155Transfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            tx: {type: DataTypes.STRING(66), allowNull: false, charset: 'ascii'} as any,
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            batchIndex: {type: DataTypes.INTEGER, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: true},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_ERC1155_TRANSFER,
            indexes: [
            ],
        })
    }
}
//=================
export interface IErc1155Transfer extends ITokenTransfer{
    id?: number
    value: string
    tokenId:string
}

export const T_ERC1155_TRANSFER = "erc1155transfer_3"

export class Erc1155Transfer extends Model<IErc1155Transfer> implements IErc1155Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    blockIndex: number
    txIndex: number
    tx: string;
    txLogIndex: number
    fromId: number
    toId: number
    value: string
    tokenId:string
    static register(seq: Sequelize) {
        Erc1155Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            tx: {type: DataTypes.STRING(66), allowNull: false, charset: 'ascii'} as any,
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: true},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ERC1155_TRANSFER,
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
                    name: 'idx_datetime',
                    fields: [{name: 'createdAt', order: "DESC"}]
                },
            ],
        })
    }
}

export async function batchPopErc1155Transfer(epoch) {
    return popPartition(epoch, Erc1155Transfer, AddressErc1155Transfer)
}
