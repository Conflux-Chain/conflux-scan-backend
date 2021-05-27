import {QueryTypes, DataTypes, Model, Sequelize} from "sequelize";
import {makeId} from "./HexMap";
import {sleep} from "../service/tool/ProcessTool";

export interface IAddressErc721Transfer {
    addressId: number
    epoch: number
    tracePos: number
    createdAt: Date
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    tokenId:string
}
export const T_ADDRESS_ERC721_TRANSFER = "address_erc721transfer"
const T_ADDRESS_ERC721_TRANSFER_SQL = `
    create table if not exists ${T_ADDRESS_ERC721_TRANSFER}
(
\t addressId bigint not null,
\t epoch bigint not null,
\t tracePos bigint not null,
\tcreatedAt datetime not null,
\ttxHashId bigint not null,
\tcontractId bigint not null,
\tfromId bigint not null,
\ttoId bigint not null,
\ttokenId varchar(78) null,
    primary key  (\`addressId\` desc,\`epoch\` desc, \`tracePos\` desc),
    KEY \`idx_createdAt\` (\`createdAt\` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by hash (addressId)
   PARTITIONS 13;
`
export async function create721partition(seq:Sequelize) {
    return seq.query(T_ADDRESS_ERC721_TRANSFER_SQL, {
        type: QueryTypes.UPDATE
    }).then(()=>{
        return AddressErc721Transfer.register(seq)
    }).then(()=>{
        AddressErc721Transfer.removeAttribute('id')
    }).catch(err=>{
        console.log(`create721partition fail: sql ${T_ADDRESS_ERC721_TRANSFER_SQL}: `, err)
        sleep(1000)
        process.exit(9)
    })
}
export class AddressErc721Transfer extends Model<IAddressErc721Transfer> implements IAddressErc721Transfer {
    addressId: number
    epoch: number
    tracePos: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    tokenId:string
    static register(seq: Sequelize) {
        AddressErc721Transfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            tracePos: {type: DataTypes.INTEGER, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: true},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_ERC721_TRANSFER,
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
//========================================
export interface IErc721Transfer {
    id?: number
    epoch: number
    createdAt: Date
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    tokenId:string
}

export const T_ERC721_TRANSFER = "erc721transfer"

export class Erc721Transfer extends Model<IErc721Transfer> implements IErc721Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    txHashId: number
    fromId: number
    toId: number
    tokenId:string
    static register(seq: Sequelize) {
        Erc721Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: true},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ERC721_TRANSFER,
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

export async function buildErc721Transfer(obj, date) {
    const fromId = await makeId(obj.from, undefined, {dt:date})
    const toId = await makeId(obj.to, undefined, {dt:date})
    const contractId = await makeId(obj.address, undefined, {dt:date})
    const hashID = await makeId(obj.transactionHash);
    let erc721Transfer:IErc721Transfer = {
        txHashId: hashID.id,
        contractId: contractId.id,
        fromId: fromId.id,
        toId: toId.id,
        createdAt: date,
        epoch: obj.epochNumber,
        tokenId: (obj.tokenId === null || obj.tokenId === undefined) ? null : obj.tokenId.toString(),
    };
    return erc721Transfer
}

export async function batchSaveErc721Transfer(array: any[], seconds) {
    let templates = []
    let date = new Date(Number(seconds)*1000)
    for (const obj of array) {
        templates.push(await buildErc721Transfer(obj, date))
    }
    // console.log(`---- ${templates.map(o=>o.epoch1).join(",")}`)
    return Erc721Transfer.bulkCreate(templates, {
        // benchmark: true, logging:console.log,
    })
}

export async function batchPopErc721Transfer(epoch) {
    return Erc721Transfer.destroy({
        where: {
            epoch: epoch
        }
    })
}