// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc721Transfer, AddressErc721Transfer} from "../model/Erc721Transfer";
import {TransferQueryBase} from "./TransferQueryBase";
import {AddressErc20Transfer} from "../model/Erc20Transfer";
const CONST = require('./common/constant');

export class Crc721TransferQuery extends TransferQueryBase{
    protected app;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    public getTransferType(): string{
        return CONST.TRANSFER_TYPE.ERC721;
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
            return await AddressErc721Transfer.findAndCountAll(queryOptions);
        }
        // either contract or address should be present. otherwise, do not count the table.
        const list = await Erc721Transfer.findAll(queryOptions);
        return {count: list.length, rows:list}
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC721;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        return AddressErc721Transfer.findAll(queryOptions);
    }
}
