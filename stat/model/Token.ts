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
// erc 1155 token id
export interface INftId {
    id?:number,
    contractHexId:number,
    nftId: number
}
export class NftId extends Model<INftId> implements INftId {
    id?:number
    contractHexId:number
    nftId: number
    static register(seq: Sequelize) {
        NftId.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            nftId: {type: DataTypes.BIGINT, allowNull: false, },
            contractHexId: {type: DataTypes.BIGINT, allowNull: false, },
        },{
            tableName: 'nft_id',
            sequelize: seq,
            indexes:[
                {name: 'idx_hex_id_token_id', unique:true, fields:[
                        {name: 'contractHexId'},
                        {name: 'nftId', order: "DESC"},
                    ]}
            ]
        })
    }
}