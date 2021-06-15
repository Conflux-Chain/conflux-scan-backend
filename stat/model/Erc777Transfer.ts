import {Op, Sequelize, Transaction, DataTypes, Model, QueryTypes} from "sequelize";
import {batchBuildId, Hex64Map, makeId} from "./HexMap";
import {AddressErc20Transfer} from "./Erc20Transfer";
import {ERC20_TRANSFER_Q, ERC777_TRANSFER_Q, RedisWrap} from "../service/RedisWrap";
import {popPartition} from "./ErcTransfer";
import {createTable} from "../service/DBProvider";

//===============================================
export interface IAddressErc777Transfer {
    addressId: number
    epoch: number
    tracePos: number
    createdAt: Date
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    value: string
}

export const T_ADDRESS_ERC777_TRANSFER = "address_erc777transfer"
const T_ADDRESS_ERC777_TRANSFER_SQL = `
    create table if not exists ${T_ADDRESS_ERC777_TRANSFER}
(
\t addressId bigint not null,
\t epoch bigint not null,
\t tracePos bigint not null,
\tcreatedAt datetime not null,
\ttxHashId bigint not null,
\tcontractId bigint not null,
\tfromId bigint not null,
\ttoId bigint not null,
\tvalue decimal(36) not null,
    primary key  (\`addressId\` desc,\`epoch\` desc, \`tracePos\` desc),
  KEY \`idx_datetime\` (\`createdAt\` DESC),
  KEY \`idx_epoch\` (\`epoch\` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by hash (addressId)
   PARTITIONS 97;
`

export async function createAddressErc777TransferTable(seq:Sequelize) {
    return createTable(seq, T_ADDRESS_ERC777_TRANSFER_SQL).then(()=>{
        return AddressErc777Transfer.register(seq)
    }).then(()=>{
        AddressErc777Transfer.removeAttribute("id")
    }).catch(err=>{
        console.log(`createAddressErc777TransferTable fail, sql ${T_ADDRESS_ERC777_TRANSFER_SQL}:`, err)
        process.exit(9)
    })
}
export class AddressErc777Transfer extends Model<IAddressErc777Transfer> implements IAddressErc777Transfer {
    addressId: number
    epoch: number
    tracePos: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    value: string
    static register(seq: Sequelize) {
        AddressErc777Transfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            tracePos: {type: DataTypes.INTEGER, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_ERC777_TRANSFER,
            indexes: [
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

export interface IErc777Transfer {
    id?: number
    epoch: number
    createdAt: Date
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    value: string
}

export const T_ERC777_TRANSFER = "erc777transfer"

export class Erc777Transfer extends Model<IErc777Transfer> implements IErc777Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    value: string
    static register(seq: Sequelize) {
        Erc777Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.STRING(78), allowNull: false},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ERC777_TRANSFER,
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

//===============================================

export async function buildErc777Transfer(obj, date) {
    const [fromId, toId, contractId] = await Promise.all([
        makeId(obj.from, undefined, {dt:date}),
        makeId(obj.to, undefined, {dt:date}),
        makeId(obj.address, undefined, {dt:date}),
        // makeId(obj.transactionHash)
    ])
    let erc777Transfer:IErc777Transfer = {
        txHashId: obj.txHashId, //hashID.id,
        contractId: contractId.id,
        fromId: fromId.id,
        toId: toId.id,
        value: (obj.value || 0).toString(),
        createdAt: date,
        epoch: obj.epochNumber,
    };
    return erc777Transfer
}

export async function batchSaveErc777Transfer(array: any[], seconds) {
    if (!array.length) {
        return;
    }
    let templates = []
    let date = new Date(Number(seconds)*1000)
    //await batchBuildId(array, 'transactionHash', 'txHashId', Hex64Map, 'ERC777Transfer')
    for (const obj of array) {
        templates.push(await buildErc777Transfer(obj, date))
    }
    // console.log(`---- ${templates.map(o=>o.epoch1).join(",")}`)
    return Promise.all([Erc777Transfer.bulkCreate(templates, {
        // benchmark: true, logging:console.log,
        }),
        RedisWrap.sendStreamMessage(templates, ERC777_TRANSFER_Q)
    ])
}

export async function batchPopErc777Transfer(epoch) {
    return RedisWrap.sendStreamMessage({action:'pop', epoch}, ERC777_TRANSFER_Q)
    // return popPartition(epoch, Erc777Transfer, AddressErc777Transfer)
}
