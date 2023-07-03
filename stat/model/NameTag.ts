import {Model, Sequelize, DataTypes} from "sequelize";

export interface INameTag {
    id?: number
    base32: string
    hex40id: number
    eoa?:boolean
    auditor: string
    epoch: number
    nameTag?: string
    website?: string
    desc?: string
    labels?: string
}

export class NameTag extends Model<INameTag> implements INameTag {
    id?: number
    base32: string
    hex40id: number
    eoa?:boolean
    auditor: string
    epoch: number
    nameTag?: string
    website?: string
    desc?: string
    labels?: string

    static register(seq: Sequelize) {
        NameTag.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            base32: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            hex40id: {type: DataTypes.BIGINT, allowNull: false},
            eoa: {type: DataTypes.BOOLEAN, allowNull: false},
            auditor: {type: DataTypes.CHAR(64), allowNull: false},
            epoch: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            nameTag: {type: DataTypes.CHAR(255), allowNull: true},
            website: {type: DataTypes.CHAR(255), allowNull: true},
            desc: {type: DataTypes.STRING(512), allowNull: true},
            labels: {type: DataTypes.CHAR(255), allowNull: true},
        }, {
            tableName: 'name_tag',
            sequelize: seq,
            timestamps: true,
            indexes: [
                {
                    name: 'idx_epoch',
                    fields: [{name: 'epoch', order: "DESC"}]
                },
            ],
        })
    }

    static async add(nameTagRecord: NameTag, dbTx = undefined): Promise<INameTag> {
        return await NameTag.create({
            base32: nameTagRecord.base32,
            hex40id: nameTagRecord.hex40id,
            eoa: nameTagRecord.eoa,
            auditor: nameTagRecord.auditor,
            epoch: nameTagRecord.epoch,
            nameTag: nameTagRecord.nameTag,
            website: nameTagRecord.website,
            desc: nameTagRecord.desc,
            labels: nameTagRecord.labels,
        }, {
            transaction: dbTx
        })
    }
}
