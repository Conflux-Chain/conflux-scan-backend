import {Model,Sequelize,DataTypes} from "sequelize";

export interface IToken{
    id?:number
    symbol:string
    holder:number
    base32:string
    hex40id:number
}

export class Token extends Model<IToken> implements IToken{
    id?:number
    symbol:string
    holder:number
    base32:string
    hex40id:number
    static register(seq:Sequelize) {
        Token.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            symbol: {type: DataTypes.CHAR(64), allowNull: false, },
            holder: {type: DataTypes.BIGINT, allowNull: false, },
            base32: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            hex40id: {type: DataTypes.BIGINT, allowNull: false, },
        },{
            tableName: 'token',
            sequelize: seq,
        })
    }
}