// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc777Transfer, AddressErc777Transfer} from "../model/Erc777Transfer";
import {TransferQueryBase} from "./TransferQueryBase";
import {AddressErc20Transfer} from "../model/Erc20Transfer";
const CONST = require('./common/constant');

export class Crc777TransferQuery extends TransferQueryBase{
    protected app;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    public getTransferType(): string{
        return CONST.TRANSFER_TYPE.ERC777;
    }
    public buildQueryFields(): any{
        return[
            ['epoch', 'epochNumber'],
            ['txHashId', 'transactionHash'],
            ['fromId', 'from'],
            ['toId', 'to'],
            'value',
            ['contractId', 'address'],
            ['createdAt', 'timestamp'],
        ];
    }
    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;

        if(options.accountAddress !== undefined){
            return await AddressErc777Transfer.findAndCountAll(queryOptions);
        }
        return await Erc777Transfer.findAndCountAll(queryOptions);
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC777;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        return AddressErc777Transfer.findAll(queryOptions);
    }
}
