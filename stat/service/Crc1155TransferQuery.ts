// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc1155Transfer, AddressErc1155Transfer} from "../model/Erc1155Transfer";
import {TransferQueryBase} from "./TransferQueryBase";
import {AddressErc20Transfer} from "../model/Erc20Transfer";
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
            ['txHashId', 'transactionHash'],
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
            return await AddressErc1155Transfer.findAndCountAll(queryOptions);
        }
        return await Erc1155Transfer.findAndCountAll(queryOptions);
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
