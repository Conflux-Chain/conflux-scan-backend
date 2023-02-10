// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc721Transfer, AddressErc721Transfer} from "../model/Erc721Transfer";
import {TransferQueryBase} from "./TransferQueryBase";
import {getAddrTransferCount} from "../model/TransferCount";
import {StatApp} from "../StatApp";
import {Token} from "../model/Token";
import {CONST} from "./common/constant"
import {FullTransaction} from "../model/FullBlock";
import {PruneType} from "../model/PruneInfo";
/*const CONST = require('./common/constant');*/

export class Crc721TransferQuery extends TransferQueryBase{
    constructor(app: any) {
        super(app);
        this.addrPruneType = PruneType.ADDR_ERC721_TRANSFER;
        this.transferType = CONST.TRANSFER_TYPE.ERC721;
        this.addrModel = AddressErc721Transfer;
    }

    public buildQueryFields({txType}): any{
        return  [
            ['epoch', 'epochNumber'],
            'blockIndex',
            'txIndex',
            'txLogIndex',
            ['fromId', 'from'],
            ['toId', 'to'],
            'tokenId',
            ['contractId', 'address'],
            ['createdAt', 'timestamp'],
        ];
    }
    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;

        if(options.accountAddress !== undefined){
            if (Object.keys(queryOptions.where).length === 1) {
                // only query by address id
                if (options.useCountCache) {
                    return this.queryWithCache(queryOptions, options);
                }
                const cacheCount = await getAddrTransferCount(queryOptions.where.addressId, CONST.TRANSFER_TYPE.ERC721)
                const rows = await AddressErc721Transfer.findAll(queryOptions);
                return {count: Math.max(cacheCount, rows.length) , rows};
            }
            return await AddressErc721Transfer.findAndCountAll(queryOptions);
        }

        if(options?.address){
            if (Object.keys(queryOptions.where).length === 1) {
                const base32 = format.address(options.address, StatApp.networkId);
                const token = await Token.findOne({attributes: ['transfer'], where:{base32}});
                const rows = await Erc721Transfer.findAll(queryOptions);
                return {count: token.transfer , rows: rows || []};
            }
            return Erc721Transfer.findAndCountAll(queryOptions);
        }

        if(options.cursor !== undefined) {
            return this.queryByCursor(Erc721Transfer, queryOptions);
        }

        // either contract or address should be present. otherwise, do not count the table.
        const list = await Erc721Transfer.findAll(queryOptions);
        return {count: list.length, rows:list}
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
        txMap: Map<string, FullTransaction>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC721;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        return AddressErc721Transfer.findAll(queryOptions);
    }
}
