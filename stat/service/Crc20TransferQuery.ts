// @ts-ignore
import {format} from "js-conflux-sdk";
import {Erc20Transfer, AddressErc20Transfer} from "../model/Erc20Transfer";
import {TransferQueryBase} from "./TransferQueryBase";
const CONST = require('./common/constant');
import {Token} from "../model/Token";
import {StatApp} from "../StatApp";
import {IndexHints} from "sequelize";
import {getAddrTransferCount} from "../model/TransferCount";

export class Crc20TransferQuery extends TransferQueryBase{
    protected app;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    public getTransferType(): string{
        return CONST.TRANSFER_TYPE.ERC20;
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
        ];
    }
    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;
        const latestRows = 10000;

        if(options.accountAddress !== undefined){
            if (Object.keys(queryOptions.where).length === 1) {
                // only query by address id
                const cacheCount = await getAddrTransferCount(queryOptions.where.addressId, 'ERC20')
                const rows = await AddressErc20Transfer.findAll(queryOptions);
                return {count: cacheCount , rows};
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
            const base32 = format.address(options.address, StatApp.networkId);
            const token = await Token.findOne({where:{base32}});
            if(token?.transfer > 10000){
                const rows = await Erc20Transfer.findAll(queryOptions);
                return {count: token.transfer , rows: rows || []};
            }
        }
        if (queryOptions.skip > 10_000) {
            throw new Error(`parameter <skip> exceeds 10000`)
        }
        // either contract or address should be present. otherwise, do not count the table.
        const list = await Erc20Transfer.findAll(queryOptions);
        return {count: list.length, rows:list}
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC20;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        return AddressErc20Transfer.findAll(queryOptions);
    }
}
