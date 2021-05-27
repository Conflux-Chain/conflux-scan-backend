import {QueryTypes, Op, Sequelize, Transaction, DataTypes, Model} from "sequelize";
import {makeId} from "./HexMap";
import {AddressErc777Transfer} from "./Erc777Transfer";
import {createTable} from "../service/DBProvider";

//=================
export interface IAddressErc1155Transfer {
    addressId: number
    epoch: number
    tracePos: number
    createdAt: Date
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    value: string
    tokenId:string
}

export const T_ADDRESS_ERC1155_TRANSFER = "address_erc1155transfer"
const T_ADDRESS_ERC1155_TRANSFER_SQL = `
create table if not exists ${T_ADDRESS_ERC1155_TRANSFER}
(
\t addressId bigint not null,
\t epoch bigint not null,
\t tracePos bigint not null,
\t createdAt datetime not null,
\t txHashId bigint not null,
\t contractId bigint not null,
\t fromId bigint not null,
\t toId bigint not null,
\t \`value\` decimal(36) not null,
\t tokenId varchar(78) null,
    primary key  (\`addressId\` desc,\`epoch\` desc, \`tracePos\` desc),
  KEY \`idx_createdAt\` (\`createdAt\` DESC)
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
    tracePos: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    value: string
    tokenId:string
    static register(seq: Sequelize) {
        AddressErc1155Transfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            tracePos: {type: DataTypes.INTEGER, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
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
                // {
                //     name: 'idx_epoch',
                //     fields: [{name: 'epoch', order: "DESC"}]
                // },
                {
                    name: 'idx_datetime',
                    fields: [{name: 'createdAt', order: "DESC"}]
                },
            ],
        })
    }
}
//=================
export class IErc1155Transfer {
    id?: number
    epoch: number
    createdAt: Date
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    value: string
    tokenId:string
}

export const T_ERC1155_TRANSFER = "erc1155transfer"

export class Erc1155Transfer extends Model<IErc1155Transfer> implements IErc1155Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    value: string
    tokenId:string
    static register(seq: Sequelize) {
        Erc1155Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
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
                    name: 'idx_contract_id',
                    fields: ['contractId']
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
//=================
export async function buildErc1155Transfer(obj, date) {
    const fromId = await makeId(obj.from, undefined, {dt:date})
    const toId = await makeId(obj.to, undefined, {dt:date})
    const contractId = await makeId(obj.address, undefined, {dt:date})
    const hashID = await makeId(obj.transactionHash);
    let erc1155Transfer:IErc1155Transfer = {
        txHashId: hashID.id,
        contractId: contractId.id,
        fromId: fromId.id,
        toId: toId.id,
        value: (obj.value || 0).toString(),
        createdAt: date,
        epoch: obj.epochNumber,
        tokenId: (obj.tokenId === null || obj.tokenId === undefined) ? null : obj.tokenId.toString(),
    };
    return erc1155Transfer
}

export async function batchSaveErc1155Transfer(array: any[], seconds) {
    let templates = []
    let date = new Date(Number(seconds)*1000)
    for (const obj of array) {
        templates.push(await buildErc1155Transfer(obj, date))
    }
    // console.log(`---- ${templates.map(o=>o.epoch1).join(",")}`)
    return Erc1155Transfer.bulkCreate(templates, {
        // benchmark: true, logging:console.log,
    })
}

export async function batchPopErc1155Transfer(epoch) {
    return Erc1155Transfer.destroy({
        where: {
            epoch: epoch
        }
    })
}