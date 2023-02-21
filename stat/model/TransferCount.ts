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
import {Erc1155Data, NftMint} from "./Token";
import {TokenBalance} from "./Balance";
import {CONST} from "../service/common/constant";

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

export interface INFTOwnerCount {
    id?:number;
    contractId:number;
    tokenId: string;
    ownerCount:number,
    updatedAt:Date;
}

export class NFTOwnerCount extends Model<INFTOwnerCount> implements INFTOwnerCount {
    id?:number;
    contractId:number;
    tokenId: string;
    ownerCount:number;
    updatedAt:Date;
    static register(seq:Sequelize) {
        NFTOwnerCount.init({
            id: {type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true},
            contractId: {type: DataTypes.BIGINT, allowNull: false},
            tokenId: {type: DataTypes.STRING(78), allowNull: false},
            ownerCount: {type: DataTypes.BIGINT, allowNull: false},
            updatedAt: {type: DataTypes.DATE, allowNull: false},
        }, {
            sequelize: seq, tableName: 'owner_count',
            indexes: [{
                name: 'idx_contractId_tokenId', fields: ['contractId','tokenId'], unique: true,
            }]
        })
    }
}

export async function getNFTOwnerCount(contractId: number, tokenId: string, type: string) : Promise<number> {
    const byCollection = tokenId === undefined;
    tokenId = byCollection ? `${-contractId}` : tokenId;
    const bean = await NFTOwnerCount.findOne({where: {contractId, tokenId}});
    if (bean !== null && Date.now() - bean.updatedAt.getTime() < cache_expire_ms) {
        return bean.ownerCount;
    }

    let ownerCount;
    const {ERC721} = CONST.TRANSFER_TYPE;
    if(byCollection) {
        ownerCount = await TokenBalance.count({where: {contractId}}).then(v=>v as any);
    } else {
        if (type === ERC721) {
            ownerCount = await NftMint.count({where: {contractId, tokenId}}).then(v=>v as any);
        } else {
            ownerCount = await Erc1155Data.count({where: {contractId, tokenId}}).then(v=>v as any);
        }
    }
    if (!ownerCount) {
        return 0;
    }

    if (bean !== null) {
        await NFTOwnerCount.update({ownerCount, updatedAt: new Date()}, {where: {contractId, tokenId}});
    } else {
        await NFTOwnerCount.upsert({contractId, tokenId, ownerCount, updatedAt: new Date()});
    }

    return ownerCount;
}