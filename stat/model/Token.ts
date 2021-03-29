import {Model,Sequelize,DataTypes} from "sequelize";

export interface IToken{
    id?:number
    symbol:string
    name?:string
    holder:number
    base32:string
    hex40id:number
    type?:string
    icon?:string
    transfer?:number
    decimals?:number
    granularity?:number
    totalSupply?:number
    price?:number
    totalPrice?:number
    quoteUrl?:string
}

export const TOKEN_ERC_1155 = 'erc1155'
export class Token extends Model<IToken> implements IToken{
    id?:number
    name?:string
    symbol:string
    holder:number
    base32:string
    hex40id:number
    type?:string
    icon?:string
    transfer?:number
    decimals?:number
    granularity?:number
    totalSupply?:number
    price?:number
    totalPrice?:number
    quoteUrl?:string

    static register(seq:Sequelize) {
        Token.init({
            id: {type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true},
            symbol: {type: DataTypes.CHAR(64), allowNull: false, },
            name: {type: DataTypes.CHAR(64), allowNull: false, defaultValue: ''},
            holder: {type: DataTypes.BIGINT, allowNull: false, },
            base32: {type: DataTypes.CHAR(64), allowNull: false, unique: true},
            hex40id: {type: DataTypes.BIGINT, allowNull: false, },
            type: {type: DataTypes.CHAR(16), allowNull: false, defaultValue: ''},
            icon: {type: DataTypes.BLOB(), allowNull: true, },
            transfer: {type: DataTypes.BIGINT, allowNull: true, },
            decimals: {type: DataTypes.BIGINT, allowNull: true, },
            granularity: {type: DataTypes.BIGINT, allowNull: true, },
            totalSupply: {type: DataTypes.DECIMAL(36, 0), allowNull: true, },
            price: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            totalPrice: {type: DataTypes.DECIMAL(36, 18), allowNull: true, },
            quoteUrl: {type: DataTypes.CHAR(255), allowNull: true, },
        },{
            tableName: 'token',
            sequelize: seq,
            timestamps: true,
        })
    }

    static async add(token: Token, dbTx = undefined): Promise<IToken> {
        return await Token.create({
            name:token.name,
            symbol:token.symbol,
            holder:token.holder,
            base32:token.base32,
            hex40id:token.hex40id,
            type:token.type,
            icon:token.icon,
            transfer:token.transfer,
            decimals:token.decimals,
            granularity:token.granularity,
            totalSupply: token.totalSupply?Number(token.totalSupply):token.totalSupply,
            price:token.price,
            totalPrice:token.totalPrice,
            quoteUrl:token.quoteUrl
        }, {
            transaction: dbTx
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