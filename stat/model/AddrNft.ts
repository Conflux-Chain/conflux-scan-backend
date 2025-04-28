import {DataTypes, Model, Sequelize} from "sequelize";
import {createTable} from "../service/DBProvider";

//=================
export const T_ADDRESS_NFT = "address_nft"

//=================
export const T_ADDRESS_NFTS = "address_nfts"

export interface IAddressNfts {
    id?:number
    addressId:number
    contractId: number
    tokenId:string
    value: number
    type: number
    createdAt:Date
    updatedAt:Date
    updatedCursor: number
}

export class AddressNfts extends Model<IAddressNfts> implements IAddressNfts {
    id?:number
    addressId:number
    contractId: number
    tokenId:string
    value: number
    type: number
    createdAt:Date
    updatedAt:Date
    updatedCursor: number
    static register(seq:Sequelize) {
        AddressNfts.init({
            id: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, autoIncrement: true, primaryKey: true},
            addressId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            contractId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            tokenId: {type: DataTypes.STRING(78), allowNull: false, },
            value: {type: DataTypes.DECIMAL(65, 0), allowNull: false, },
            type: {type: DataTypes.SMALLINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
            updatedCursor: {type: DataTypes.BIGINT({unsigned: true}), allowNull: true, },
        },{
            sequelize: seq,
            tableName: T_ADDRESS_NFTS,
            timestamps: false,
            indexes: [
                {name: 'uk_aid_cid_tid', fields:['addressId','contractId','tokenId'], unique: true},
                {name: 'idx_aid_cid_cur_val', fields:['addressId', 'contractId', 'updatedCursor', 'value']},
                {name: 'idx_cid_cur_val', fields:['contractId', 'updatedCursor', 'value']},
                {name: 'idx_aid_cid_updateTime', fields:['addressId', 'contractId', 'updatedAt']},
                {name: 'idx_cid_updateTime', fields:['contractId', 'updatedAt']},
            ]
        })
    }
}
