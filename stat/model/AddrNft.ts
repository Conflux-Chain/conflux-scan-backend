import {DataTypes, Model, Sequelize} from "sequelize";
import {createTable} from "../service/DBProvider";

//=================
export const T_ADDRESS_NFT = "address_nft"

const T_ADDRESS_NFT_SQL = `
CREATE TABLE IF NOT EXISTS ${T_ADDRESS_NFT}
(
  \`addressId\` bigint(20) NOT NULL,
  \`contractId\` bigint(20)  NOT NULL,
  \`tokenId\` varchar(78) NOT NULL,
  \`value\` varchar(78) NOT NULL,
  \`type\` smallint(6) NOT NULL,
  \`createdAt\` datetime NOT NULL,
  \`updatedAt\` datetime NOT NULL,
  PRIMARY KEY (\`addressId\`, \`contractId\`, \`tokenId\`),
  KEY \`idx_addressId_type\` (\`addressId\`, \`type\`),
  KEY \`idx_contractId\` (\`contractId\`),
  KEY \`idx_updatedAt\` (\`updatedAt\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY HASH (addressId)
   PARTITIONS 97;
`
export async function createAddressNftTable(seq:Sequelize) {
    return createTable(seq, T_ADDRESS_NFT_SQL).then(()=>{
        return AddressNft.register(seq)
    }).then(()=>{
        AddressNft.removeAttribute("id")
    }).catch(err=>{
        console.log(`createAddressNftTable fail, sql ${T_ADDRESS_NFT_SQL}:`, err)
        process.exit(9)
    })
}

export interface IAddressNft {
    addressId:number
    contractId: number
    tokenId:string
    value: number
    type: number
}
export class AddressNft extends Model<IAddressNft> implements IAddressNft {
    addressId:number;
    contractId: number
    tokenId:string
    value: number
    type: number
    static register(seq:Sequelize) {
        AddressNft.init({
            addressId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            contractId: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false, },
            tokenId: {type: DataTypes.STRING(78), allowNull: false, },
            value: {type: DataTypes.DECIMAL(65, 0), allowNull: false, },
            type: {type: DataTypes.SMALLINT, allowNull: false},
        },{
            sequelize: seq,
            tableName: T_ADDRESS_NFT,
            indexes: [
            ]
        })
    }
}