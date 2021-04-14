import {Op, Sequelize, Transaction, DataTypes, Model} from "sequelize";
import {makeId} from "./HexMap";

export class IErc721Transfer {
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