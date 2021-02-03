import {Sequelize, DataTypes, Model, Transaction} from "sequelize";

/**
 * mapping a hex64 to a number in DB, to decrease data length and make effective index.
 */
export interface IAddress{
    id: number;
    hex40: string;
    base32: string;
}
export class Address extends Model<IAddress> implements IAddress{
    id: number;
    hex40: string;
    base32: string;
    static register(seq: Sequelize) {
        Address.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
            hex40: {type: DataTypes.CHAR(40), allowNull: false,},
            base32: {type: DataTypes.CHAR(128), allowNull: false,},
        },{
            sequelize: seq,
            tableName: T_ADDRESS,
            indexes: [
                {
                    name: 'addr_hex_40_u',
                    fields: ['hex40'],
                    unique: true,
                }
            ]
        })
    }
}
export interface HexMapAttributes {
    id: number;
    hex: string
}

class HexMap extends Model<HexMapAttributes> implements HexMapAttributes {
    public id: number;
    public hex: string;
}

export class Hex64Map extends HexMap{}
export class Hex40Map extends HexMap{}

// https://sequelize.org/master/class/lib/model.js~Model.html#static-method-findOrCreate
export async function makeId(hex: string, dbTx: Transaction = undefined) {
    if (hex === '0x0') {
        return {id:0};
    }
    if (hex.startsWith('0x')) {
        hex = hex.substr(2);
    }
    let map = Hex64Map;
    switch (hex.length) {
        case 64: break;
        case 40: map = Hex40Map; break;
        default: throw new Error(`Unsupported hex length ${hex.length}`)
    }
    const [bean] = await map.findOrCreate({where: {hex: hex},
        defaults: {id: 0, hex},
        transaction: dbTx
    });
    // console.info(`created ${created}`)
    return bean;
}
export const T_ADDRESS = 'address'
export function hexMapInit(sequelize) {
    hexMapInit0(sequelize, Hex40Map, 40, 'hex40')
    hexMapInit0(sequelize, Hex64Map, 64, 'hex64')
}
function hexMapInit0(sequelize, clz, length, tableName:string) {
    clz.init(
        {
            id: {
                type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true
            },
            hex: {
                type: DataTypes.CHAR(length), allowNull: false,
            },
        },
        {
            tableName: tableName,
            sequelize: sequelize,
            timestamps: false, // prevent default columns: createdAt, updatedAt
            indexes: [
                {
                    name: `hex${length}_index`,
                    fields: [
                        {
                            name: 'hex',
                            // length: 10,
                        }
                    ],
                    unique: true
                }
            ]
        }
    )

}


export const ADDR_INFO_STATE_OK = 'ok'
export const ADDR_INFO_STATE_DELETED = 'deleted'
export interface IAddressInfo {
    id?: number; // refer to hex40 id
    name: string;
    createAt: Date;
    updateAt: Date;
    remark: string;
    state: string; // ok, deleted
}
export const T_ADDRESS_INFO = 'address_info'
export class AddressInfo extends Model<IAddressInfo> implements IAddressInfo {
    id?: number; // refer to hex40 id
    name: string;
    createAt: Date;
    updateAt: Date;
    remark: string;
    state: string;
    static register(seq: Sequelize) {
        AddressInfo.init({
            id:       {type: DataTypes.BIGINT, allowNull: false, primaryKey: true},
            name:     {type: DataTypes.CHAR(32), allowNull: false, unique: true},
            createAt: {type: DataTypes.DATE, allowNull: false},
            updateAt: {type: DataTypes.DATE, allowNull: false},
            remark:   {type: DataTypes.CHAR(128), allowNull: false, defaultValue: ''},
            state:   {type: DataTypes.CHAR(16), allowNull: false, defaultValue: ADDR_INFO_STATE_OK},
        },{
            tableName: T_ADDRESS_INFO,
            sequelize: seq,
            timestamps: false
        })
    }
}