// @ts-ignore
import {format} from "js-conflux-sdk";
import {TransferQueryBase} from "./TransferQueryBase";
import {getAddrTransferCount} from "../model/TransferCount";
import {AddressTransfer} from "../model/AddrTransfer";
import {CONST} from "./common/constant";
import {FullTransaction} from "../model/FullBlock";
import {fmtAddr, StatApp} from "../StatApp";
import {PruneType} from "../model/PruneInfo";
const lodash = require('lodash');

export class AccountTransferQuery extends TransferQueryBase{
    protected app;
    protected CODE_TYPE_MAP;

    constructor(app: any) {
        super(app);
        this.app = app;
        this.CODE_TYPE_MAP = lodash.keyBy(Object.values(CONST.ADDRESS_TRANSFER_TYPE), 'code');
    }

    public getTransferType(): string{
        return CONST.TRANSFER_TYPE.ALL;
    }
    public getAddrPruneType(): string {
        return PruneType.ADDR_TRANSFER;
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
            'nonce', 'method', 'status',
            ['gas', 'gasFee'],
            ['tx', 'transactionHash'],

            'type',
            ['createdAt', 'timestamp'],
        ];
    }

    public async doQuery(options: any, queryOptions: any): Promise<any>{
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

    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
        txMap: Map<string, FullTransaction>): Promise<any>{
        const {ADDRESS_TRANSFER_TYPE: {TX, ERC20, ERC721, ERC1155}} = CONST;
        const isTx = row['type'] === TX.code;
        const isToken = row['type'] === ERC20.code || row['type'] === ERC721.code || row['type'] === ERC1155.code;
        const addr = hex40Map.get(row['address']);
        row['address'] = !isToken && !isTx ? undefined : (addr ? fmtAddr(`0x${addr}`, StatApp.networkId) : undefined);
        row['tokenId'] = !isToken ? undefined : row['tokenId'];
        row['type'] = this.CODE_TYPE_MAP[row['type']].name;

        // if(isTx){
        //     const tx = txMap.get(`${row['epochNumber']}_${row['blockIndex']}_${row['txIndex']}`);
        //     row['chainId'] = StatApp.networkId;
        //     row['nonce'] = tx?.nonce;
        //     row['method'] = tx?.method;
        //     row['status'] = tx?.status;
        //     row['gasFee'] = tx?.gas;
        // }

        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        throw new Error('not implemented');
    }
}
