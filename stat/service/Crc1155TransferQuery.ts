// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc1155Transfer, AddressErc1155Transfer} from "../model/Erc1155Transfer";
import {TransferQueryBase} from "./TransferQueryBase";
import {getAddrTransferCount} from "../model/TransferCount";
const CONST = require('./common/constant');

export class Crc1155TransferQuery extends TransferQueryBase{
    protected app;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    public getTransferType(): string{
        return CONST.TRANSFER_TYPE.ERC1155;
    }
    public buildQueryFields({txType}): any{
        return [
            ['epoch', 'epochNumber'],
            'blockIndex',
            'txIndex',
            'txLogIndex',
            ['fromId', 'from'],
            ['toId', 'to'],
            'tokenId',
            'value',
            ['contractId', 'address'],
            ['createdAt', 'timestamp'],
        ];
    }
    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;

        if(options.accountAddress !== undefined){
            if (Object.keys(queryOptions.where).length === 1) {
                // only query by address id
                const cacheCount = await getAddrTransferCount(queryOptions.where.addressId, CONST.TRANSFER_TYPE.ERC1155)
                const rows = await AddressErc1155Transfer.findAll(queryOptions);
                return {count: Math.max(cacheCount, rows.length) , rows};
            }
            return await AddressErc1155Transfer.findAndCountAll(queryOptions);
        }
        // either contract or address should be present. otherwise, do not count the table.
        const list = await Erc1155Transfer.findAll(queryOptions);
        return {count: list.length, rows:list}
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC1155;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        return AddressErc1155Transfer.findAll(queryOptions);
    }
}
