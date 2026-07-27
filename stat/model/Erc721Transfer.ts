import {QueryTypes, DataTypes, Model, Sequelize} from "sequelize";
import {makeId, makeIdV} from "./HexMap";
import {sleep} from "../service/tool/ProcessTool";
import {createTable} from "../service/DBProvider";
import {popPartition} from "./ErcTransfer";
import {Erc20Transfer, ITokenTransfer} from "./Erc20Transfer";

export interface IAddressErc721Transfer extends ITokenTransfer{
    addressId: number
    tokenId:string
}
export const T_ADDRESS_ERC721_TRANSFER = "address_erc721transfer_3"
const T_ADDRESS_ERC721_TRANSFER_SQL = `
    create table if not exists ${T_ADDRESS_ERC721_TRANSFER}
(
\t addressId bigint not null,
\t epoch bigint not null,
\tcreatedAt datetime not null,
\`blockIndex\` int unsigned NOT NULL,
  \`txIndex\` mediumint unsigned NOT NULL,
\`txLogIndex\` mediumint unsigned NOT NULL,
    tx char(66)  character set 'ascii' not null,
\tcontractId bigint not null,
\tfromId bigint not null,
\ttoId bigint not null,
\ttokenId varchar(78) null,
    primary key  (\`addressId\` desc,\`epoch\` desc, \`blockIndex\` desc, txIndex desc, txLogIndex desc),
    KEY \`idx_addr_token_id\`( \`addressId\`, \`tokenId\`, \`epoch\` ),
    KEY idx_addr_epoch ( addressId, epoch desc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by hash (addressId)
   PARTITIONS 13;
`
export async function create721partition(seq:Sequelize) {
    return createTable(seq, T_ADDRESS_ERC721_TRANSFER_SQL).then(()=>{
        return AddressErc721Transfer.register(seq)
    }).then(()=>{
        AddressErc721Transfer.removeAttribute('id')
    }).catch(err=>{
        console.log(`create721partition fail: sql ${T_ADDRESS_ERC721_TRANSFER_SQL}: `, err)
        sleep(1000)
        process.exit(9)
    })
}
export class AddressErc721Transfer extends Model<IAddressErc721Transfer> implements IAddressErc721Transfer {
    addressId: number
    epoch: number
    createdAt: Date
    contractId: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    tx: string
    fromId: number
    toId: number
    tokenId:string
    static register(seq: Sequelize) {
        AddressErc721Transfer.init({
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            tx: {type: DataTypes.STRING(66), allowNull: false, charset: 'ascii'} as any,
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: true},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ADDRESS_ERC721_TRANSFER,
            indexes: [
            ],
        })
    }
}
//========================================
export interface IErc721Transfer extends ITokenTransfer{
    id?: number
    tokenId:string
}

export const T_ERC721_TRANSFER = "erc721transfer_3"

export class Erc721Transfer extends Model<IErc721Transfer> implements IErc721Transfer {
    id?: number
    epoch: number
    createdAt: Date
    contractId: number
    blockIndex: number
    txIndex: number
    txLogIndex: number
    tx: string
    fromId: number
    toId: number
    tokenId:string
    static register(seq: Sequelize) {
        Erc721Transfer.init({
            id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false},
            epoch: {type: DataTypes.BIGINT, allowNull: false},
            createdAt: {type: DataTypes.DATE, allowNull: false},
            blockIndex: {type: DataTypes.SMALLINT, allowNull: false},
            txIndex: {type: DataTypes.INTEGER, allowNull: false},
            txLogIndex: {type: DataTypes.INTEGER, allowNull: false},
            tx: {type: DataTypes.STRING(66), allowNull: false, charset: 'ascii'} as any,
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            fromId: {type: DataTypes.BIGINT, allowNull: false},
            toId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: true},
        }, {
            sequelize: seq,
            updatedAt: false,
            tableName: T_ERC721_TRANSFER,
            indexes: [
                {
                    name: 'idx_contractId_epoch',
                    fields: ['contractId','epoch']
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

// noinspection DuplicatedCode
export async function buildErc721Transfer(obj, date) {
    const fromId = await makeIdV(obj.from, undefined, {dt:date})
    const toId = await makeIdV(obj.to, undefined, {dt:date})
    const contractId = await makeIdV(obj.address, undefined, {dt:date})
    obj['txIndex'] = obj.transactionIndex;
    obj['contractId'] = contractId
    obj['fromId'] = fromId
    obj['toId'] = toId
    obj.value = obj.value?.toString() || '0'
    obj.txLogIndex = obj.transactionLogIndex;
    obj.tokenId = (obj.tokenId === null || obj.tokenId === undefined) ? null : obj.tokenId.toString();
    // let erc721Transfer:IErc721Transfer = {
    //     blockIndex: obj.blockIndex, //
    //     txIndex: obj.transactionIndex,
    //     contractId: contractId.id,
    //     fromId: fromId.id,
    //     toId: toId.id,
    //     createdAt: date,
    //     epoch: obj.epochNumber,
    //     tokenId: (obj.tokenId === null || obj.tokenId === undefined) ? null : obj.tokenId.toString(),
    //     txLogIndex: obj.transactionLogIndex,
    // };
    // return erc721Transfer
}
