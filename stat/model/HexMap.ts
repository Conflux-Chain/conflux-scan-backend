import {DataTypes, Model, Transaction} from "sequelize";

/**
 * mapping a hex64 to a number in DB, to decrease data length and make effective index.
 */
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

export function hexMapInit(sequelize) {
    hexMapInit0(sequelize, Hex40Map, 40)
    hexMapInit0(sequelize, Hex64Map, 64)
}
function hexMapInit0(sequelize, clz, length) {
    clz.init(
        {
            id: {
                type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true
            },
            hex: {
                type: DataTypes.CHAR(length), allowNull: false
            }
        },
        {
            tableName: `hex${length}`,
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

