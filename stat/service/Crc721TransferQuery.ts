// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc721Transfer, AddressErc721Transfer} from "../model/Erc721Transfer";
import {TransferQueryBase} from "./TransferQueryBase";
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
    public buildQueryFields(): any{
        return  [
            ['epoch', 'epochNumber'],
            ['txHashId', 'transactionHash'],
            ['fromId', 'from'],
            ['toId', 'to'],
            'tokenId',
            ['contractId', 'address'],
            ['createdAt', 'timestamp'],
        ];
    }
    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;

        if(options.address !== undefined){
            logger?.info({src: `${this.getTransferType()}.all.findAndCountAll--------`, 'options': JSON.stringify(options)});
            return await Erc721Transfer.findAndCountAll(queryOptions);
        }
        logger?.info({src: `${this.getTransferType()}.address.findAndCountAll--------`, 'options': JSON.stringify(options)});
        return await AddressErc721Transfer.findAndCountAll(options);
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
                              contractInfoMap: Map<number, object>, tokenInfoMap: Map<number, object>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC721;
        return row;
    }
}
