// @ts-ignore
import {format} from "js-conflux-sdk";
import {TransferQueryBase} from "./TransferQueryBase";
import {getAddrTransferCount} from "../model/TransferCount";
import {AddressTransfer} from "../model/AddrTransfer";
import {CONST} from "./common/constant";
const lodash = require('lodash');

export class AddrTransferQuery extends TransferQueryBase{
    protected app;
    protected CODE_TYPE_MAP;

    constructor(app: any) {
        super(app);
        this.app = app;
        this.CODE_TYPE_MAP = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'code');
    }

    public getTransferType(): string{
        return 'ALL';
    }

    public buildQueryFields({txType}): any{
        return [
            ['epoch', 'epochNumber'],
            'blockIndex',
            'txIndex',
            'txLogIndex',

            ['fromId', 'from'],
            ['toId', 'to'],
            ['contractId', 'address'],
            'tokenId',
            'value',

            'type',
            ['createdAt', 'timestamp'],
        ];
    }

    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;

        if(options.accountAddress === undefined){
            return {count: 0, rows: []};
        }

        if (Object.keys(queryOptions.where).length === 1) {
            const cacheCount = await getAddrTransferCount(queryOptions.where.addressId, this.getTransferType());
            const rows = await AddressTransfer.findAll(queryOptions);
            return {count: Math.max(cacheCount, rows.length) , rows};
        }

        return await AddressTransfer.findAndCountAll(queryOptions);
    }

    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['type'] = this.CODE_TYPE_MAP[row['type']].name;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        throw new Error('not implemented');
    }
}
