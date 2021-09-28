import {CfxTransfer, pagingFullCfxTransfer, AddressCfxTransfer} from "../model/CfxTransfer";
import {TransferQueryBase} from "./TransferQueryBase";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {KEY_FULL_CFX_TRANSFER_COUNT, KV} from "../model/KV";
import {Op} from "sequelize";
const CONST = require('./common/constant');

export class CfxTransferQuery extends TransferQueryBase{
    protected app;

    constructor(app: any) {
        super(app);
        this.app = app;
    }

    public getTransferType(): string{
        return CONST.TRANSFER_TYPE.CFX;
    }

    public buildQueryOptions({minEpochNumber, maxEpochNumber, transactionHashId,
                                 minTimestamp, maxTimestamp,
                                 accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray,
                                 tokenId, txType, skip, limit, sort}){
        const{ logger } = this.app;
        if(txType === CONST.TX_TYPE.CREATE){
            // page
            const queryOptions: any = {offset: skip, limit, raw: true};
            // condition
            const conditionArray = [];
            conditionArray.push({from: accountAddressId});
            conditionArray.push({value: { [Op.gt]: 0}});
            if(transactionHashId) {
                conditionArray.push({txHashId: transactionHashId});
            }
            if(fromAddressId !== undefined) {
                conditionArray.push({from: fromAddressId});
            }
            if(minEpochNumber) {
                conditionArray.push({epochNumber: { [Op.gte]: minEpochNumber}});
            }
            if(maxEpochNumber) {
                conditionArray.push({epochNumber: { [Op.lte]: maxEpochNumber}});
            }
            if(minTimestamp) {
                conditionArray.push({blockTime: { [Op.gte]: minTimestamp}});
            }
            if(maxTimestamp) {
                conditionArray.push({blockTime: { [Op.lte]: maxTimestamp}});
            }
            if(conditionArray.length === 1){
                queryOptions.where = conditionArray[0];
            }
            if(conditionArray.length > 1){
                queryOptions.where = {};
                queryOptions.where[Op.and] = conditionArray;
            }
            // order
            queryOptions.order = [['epochNumber', sort],['id', sort]];
            return queryOptions;
        }

       return super.buildQueryOptions({minEpochNumber, maxEpochNumber, transactionHashId,
            minTimestamp, maxTimestamp,
            accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray,
            tokenId, txType, skip, limit, sort});
    }

    public buildQueryFields({accountAddressId, txType}): any{
        if(txType === CONST.TX_TYPE.CREATE){
            return [
                'epochNumber',
                ['txHashId', 'transactionHash'],
                'from',
                'to',
                'value',
                ['blockTime', 'timestamp'],
            ];
        }

        return [
            ['epoch', 'epochNumber'],
            ['txHashId', 'transactionHash'],
            ['fromId', 'from'],
            ['toId', 'to'],
            'value',
            ['createdAt', 'timestamp'],
        ];
    }

    public async doQuery(options: any, queryOptions: any): Promise<any>{
        const{ logger } = this.app;

        if(options.txType === CONST.TX_TYPE.CREATE){
            return await TraceCreateContract.findAndCountAll(queryOptions);
        }
        if(options.accountAddress !== undefined){
            return await AddressCfxTransfer.findAndCountAll(queryOptions);
        }

        const pagedCondition = await this.buildPagedCfxTransferOptions(options.skip);
        if(pagedCondition.where){
            queryOptions.where = {[Op.and]: [pagedCondition.where, queryOptions.where]};
            queryOptions.offset = pagedCondition.skip;
        }
        const rows = await CfxTransfer.findAll(queryOptions);
        const count =  await KV.getNumber(KEY_FULL_CFX_TRANSFER_COUNT);
        return {count: count || 0, rows: rows || []};
    }

    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>): Promise<any>{
        row['transferType'] = CONST.TRANSFER_TYPE.CFX;
        return row;
    }

    private async buildPagedCfxTransferOptions(skip){
        const pagedCondition: any = {};
        const cfxTransferPage = await pagingFullCfxTransfer(skip);
        if(cfxTransferPage && cfxTransferPage.id !== Infinity){
            pagedCondition.where = {
                [Op.or]: [
                    {epoch: {[Op.lt]: cfxTransferPage.epoch}},
                    {[Op.and]: [
                            {epoch: cfxTransferPage.epoch},
                            {id: {[Op.lt]: cfxTransferPage.dataId}},
                        ]},
                ]
            };
            pagedCondition.skip = cfxTransferPage.skip;
        }
        return pagedCondition;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        throw new Error(`${this.getTransferType()} no need count account address!`);
    }
}
