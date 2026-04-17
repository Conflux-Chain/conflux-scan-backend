// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc20Transfer, AddressErc20Transfer} from "../model/Erc20Transfer";
import {patchTokenTxQueryRange, TransferQueryBase} from "./TransferQueryBase";
import {CONST} from "./common/constant"
import {Token} from "../model/Token";
import {fmtAddr, StatApp} from "../StatApp";
import {getAddrTransferCount} from "../model/TransferCount";
import {FullTransaction} from "../model/FullBlock";
import {PruneType} from "../model/PruneInfo";

export class Crc20TransferQuery extends TransferQueryBase{

    constructor(app: any) {
        super(app);
        this.addrPruneType = PruneType.ADDR_ERC20_TRANSFER;
        this.transferType = CONST.TRANSFER_TYPE.ERC20;
        this.addrModel = AddressErc20Transfer;
    }

    public buildQueryFields({txType}): any{
        return [
            ['epoch', 'epochNumber'],
            'blockIndex',
            'txIndex',
            'txLogIndex',
            ['fromId', 'from'],
            ['toId', 'to'],
            'value',
            ['contractId', 'address'],
            ['createdAt', 'timestamp'],
            ['tx', 'transactionHash'],
        ];
    }
    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const latestRows = 10000;

        if(options.accountAddress !== undefined){
            if (Object.keys(queryOptions.where).length === 1) {
                // only query by address id
                if (options.useCountCache) {
                    return this.queryWithCache(queryOptions, options);
                }
                const cacheCount = await getAddrTransferCount(queryOptions.where.addressId, CONST.TRANSFER_TYPE.ERC20)
                const rows = await AddressErc20Transfer.findAll(queryOptions);
                return {count: Math.max(cacheCount, rows.length) , rows};
            }
            const cloneQueryOptions = {...queryOptions, offset: latestRows, limit: 1};
            const one = await AddressErc20Transfer.findOne(cloneQueryOptions);
            if(one !== null){
                const rows = await AddressErc20Transfer.findAll(queryOptions);
                return {count: latestRows , rows: rows || []};
            }
            return await AddressErc20Transfer.findAndCountAll(queryOptions);
        }

        if(options?.address){
            if (Object.keys(queryOptions.where).length === 1) {
                const base32 = format.address(options.address, StatApp.networkId);
                const token = await Token.findOne({attributes: ['transfer'], where:{base32}});
                await patchTokenTxQueryRange(token, queryOptions, Erc20Transfer);
                const rows = await Erc20Transfer.findAll(queryOptions);
                return {count: token?.transfer || rows.length , rows: rows || []};
            }
            return Erc20Transfer.findAndCountAll(queryOptions);
        }

        // either contract or address should be present. otherwise, do not count the table.
        const list = await Erc20Transfer.findAll(queryOptions);
        return {count: list.length, rows:list}
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
        txMap: Map<string, FullTransaction>): Promise<any>{
        row['address'] = fmtAddr(`0x${hex40Map.get(row['address'])}`, StatApp.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC20;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        return AddressErc20Transfer.findAll(queryOptions);
    }
}
