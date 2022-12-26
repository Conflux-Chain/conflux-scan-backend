import {
    Transaction,
    Model,
    DataTypes,
    Sequelize,
    Op,
    UniqueConstraintError,
    ModelStatic,
    DatabaseError
} from "sequelize";
import {AddressErc20Transfer} from "./Erc20Transfer";
import {AddressErc721Transfer} from "./Erc721Transfer";
import {AddressErc1155Transfer} from "./Erc1155Transfer";
import {AddressCfxTransfer} from "./CfxTransfer";
import {AddressTransfer} from "./AddrTransfer";
import {AddrEvent3525} from "../T3525Sync";
import {AddressTransactionIndex} from "./FullBlock";

/**
 * Transfer count cache for address.
 */
const cache_expire_ms = 60_000
/*declare type TRANSFER_TYPE = 'ERC20' | 'ERC721' | 'ERC1155' | 'CFX'*/

export interface ITransferCount {
    id?:number; addressId:number; type: string; v:number, updatedAt:Date;
}
export class TransferCount extends Model<ITransferCount> implements ITransferCount {
    id?:number; addressId:number; type: string; v:number; updatedAt:Date;
    static register(seq:Sequelize) {
        TransferCount.init({
            id: {type: DataTypes.BIGINT({unsigned: true}, ), autoIncrement: true, primaryKey: true},
            addressId: {type: DataTypes.BIGINT, allowNull: false},
            type: {type: DataTypes.STRING(16), allowNull: false},
            v: {type: DataTypes.BIGINT({unsigned: true}), allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq, tableName: 'transfer_count',
            indexes: [{
                name: 'idx_addr_type', fields: ['addressId','type'], unique: true,
            }]
        })
    }
}

export async function getAddrTransferCount(addrId: number, type: string) : Promise<number> {
    const bean = await TransferCount.findOne({
        where: {addressId: addrId, type}
    })
    if (bean !== null
        // cache for 1 minute
        && Date.now() - bean.updatedAt.getTime() < cache_expire_ms) {
        return bean.v
    }
    const map = {'ERC20' : AddressErc20Transfer, 'ERC721' : AddressErc721Transfer
        , 'ERC1155' : AddressErc1155Transfer
        , 'ERC3525' : AddrEvent3525, 'TX': AddressTransactionIndex
        , 'CFX': AddressCfxTransfer, 'ALL': AddressTransfer}
    const model = map[type]
    if (!model) {
        console.log(`get transfer count with unknown type: [${type}]`)
        return 0;
    }
    // @ts-ignore
    const v = await model.count({where: {addressId: addrId}}).then(v=>v as any)
    if (!v) {
        return 0; // do not cache zero
    }
    if (bean !== null) {
        await TransferCount.update(
            {v, updatedAt: new Date()},
            { where: {addressId: addrId, type} }
        )
    } else {
        await TransferCount.upsert({
            addressId: addrId, type, updatedAt: new Date(), v
        });
    }
    return v;
}