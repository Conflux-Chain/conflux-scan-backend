// @ts-ignore
import {Conflux, format} from "js-conflux-sdk";
import {TransferQueryBase} from "./TransferQueryBase";
import {getAddrTransferCount} from "../model/TransferCount";
import {StatApp} from "../StatApp";
import {Token} from "../model/Token";
import {CONST} from "./common/constant"
import {FullTransaction} from "../model/FullBlock";
import {AddrEvent3525, Event3525} from "../T3525Sync";
import {init} from "./tool/FixDailyTokenStat";
import {FullBlockQuery} from "./FullBlockQuery";
/*const CONST = require('./common/constant');*/

export class Crc3525TransferQuery extends TransferQueryBase{
    protected app;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    public getTransferType(): string{
        return CONST.TRANSFER_TYPE.ERC3525;
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
            'value', 'fromTokenId', 'toTokenId', 'event', 'slot',
            ['contractId', 'address'],
            ['createdAt', 'timestamp'],
        ];
    }
    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;

        if(options.accountAddress !== undefined){
            if (Object.keys(queryOptions.where).length === 1) {
                // only query by address id
                const cacheCount = await getAddrTransferCount(queryOptions.where.addressId, CONST.TRANSFER_TYPE.ERC3525)
                const rows = await AddrEvent3525.findAll(queryOptions);
                return {count: Math.max(cacheCount, rows.length) , rows};
            }
            return await AddrEvent3525.findAndCountAll(queryOptions);
        }

        if(options?.address){
            if (Object.keys(queryOptions.where).length === 1) {
                const base32 = format.address(options.address, StatApp.networkId);
                const token = await Token.findOne({attributes: ['transfer'], where:{base32}});
                if(token) {
                    const rows = await Event3525.findAll(queryOptions);
                    return {count: token.transfer, rows: rows || []};
                }
            }
            return Event3525.findAndCountAll(queryOptions);
        }

        // either contract or address should be present. otherwise, do not count the table.
        const list = await Event3525.findAll(queryOptions);
        return {count: list.length, rows:list}
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
        txMap: Map<string, FullTransaction>): Promise<any>{
        row['address'] = format.address(`0x${hex40Map.get(row['address'])}`, this.app?.networkId);
        row['transferType'] = CONST.TRANSFER_TYPE.ERC3525;
        return row;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        return AddrEvent3525.findAll(queryOptions);
    }
}
async function main() {
    let config = await init();
    let cfx = new Conflux(config.conflux)
    await cfx.updateNetworkId();
    StatApp.networkId = cfx.networkId;
    let fullBlockQuery = new FullBlockQuery({cfx})
    let contract = '0x062ce55ec28f356b42db0783d166d76cfc0bb133'
    const q3525 =  new Crc3525TransferQuery({service: {fullBlockQuery}, networkId: cfx.networkId})
    await q3525.listTransfer({address: contract}).then(res=>{
        console.log(`list 3525 transfer`, res)
    })
    await q3525.listTransfer({accountAddress: 'net71:adfts2wa0njg8z2fxg0j3zrv3t9s0vy2z65zybcpt1'}).then(res=>{
        console.log(`list addr 3525 transfer`, res)
    })
}
if (module === require.main) {
    main().then()
}