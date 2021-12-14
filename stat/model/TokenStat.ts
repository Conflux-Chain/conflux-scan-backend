import {Sequelize, col, fn, QueryTypes, Model, DataTypes} from 'sequelize'
export interface IHourlyToken {
    id?:number
    createdAt: Date

    hexId:number
    uniqueReceiver:number
    uniqueSender:number
    participants:number
}
export class HourlyToken extends Model<IHourlyToken> implements IHourlyToken {
    id?:number
    hexId:number
    createdAt: Date
    uniqueReceiver:number
    uniqueSender:number
    participants:number
    static register(seq:Sequelize) {
        HourlyToken.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            hexId: {type: DataTypes.BIGINT, allowNull: false, },
            uniqueReceiver: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            uniqueSender: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            participants: {type: DataTypes.BIGINT({unsigned:true}), allowNull: false, defaultValue: 0},
            createdAt: {type: DataTypes.DATE(), allowNull: false},
        },{
            sequelize: seq,
            tableName: 'hourly_token',
            indexes: [
                {name: 'uk_dt_hexId', fields:['createdAt','hexId'], unique: true}
            ]
        })
    }
}