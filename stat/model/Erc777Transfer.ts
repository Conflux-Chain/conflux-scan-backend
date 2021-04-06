import {Op, Sequelize, Transaction, DataTypes, Model} from "sequelize";
import {makeId} from "./HexMap";

export class IErc777Transfer {
    id?: number
    epoch: number
    createdAt: Date
    txHashId: number
    contractId: number
    fromId: number
    toId: number
    value: number
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
    value: number
    static register(seq: Sequelize) {
        Erc777Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txHashId: {type: DataTypes.BIGINT, allowNull: false},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            value: {type: DataTypes.DECIMAL(36, 0), allowNull: false},
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

export async function buildErc777Transfer(obj, date) {
    const fromId = await makeId(obj.from)
    const toId = await makeId(obj.to)
    const contractId = await makeId(obj.address)
    const hashID = await makeId(obj.transactionHash);
    let erc777Transfer:IErc777Transfer = {
        txHashId: hashID.id,
        contractId: contractId.id,
        fromId: fromId.id,
        toId: toId.id,
        value: obj.value || 0,
        createdAt: date,
        epoch: obj.epochNumber,
    };
    return erc777Transfer
}

export async function batchSaveErc777Transfer(array: any[], seconds) {
    let templates = []
    let date = new Date(Number(seconds)*1000)
    for (const obj of array) {
        templates.push(await buildErc777Transfer(obj, date))
    }
    // console.log(`---- ${templates.map(o=>o.epoch1).join(",")}`)
    return Erc777Transfer.bulkCreate(templates, {
        // benchmark: true, logging:console.log,
    })
}

export async function batchPopErc777Transfer(epoch) {
    return Erc777Transfer.destroy({
        where: {
            epoch: epoch
        }
    })
}