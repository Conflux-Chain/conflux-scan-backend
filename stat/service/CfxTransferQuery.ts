import {CfxTransfer, pagingFullCfxTransfer, AddressCfxTransfer} from "../model/CfxTransfer";
import {TraceCreateContract} from "../model/TraceCreateContract";
import {KEY_FULL_CFX_TRANSFER_COUNT, KV} from "../model/KV";
import {Op} from "sequelize";
import {TransferQueryBase} from "./TransferQueryBase";
import {getAddrTransferCount} from "../model/TransferCount";
import {CONST} from "./common/constant"
import {Errors} from "./common/LogicError";
import {FullTransaction} from "../model/FullBlock";
import {PruneType} from "../model/PruneInfo";

export class CfxTransferQuery extends TransferQueryBase{
    constructor(app: any) {
        super(app);
        this.addrPruneType = PruneType.ADDR_CFX_TRANSFER;
        this.transferType = CONST.TRANSFER_TYPE.CFX;
        this.addrModel = AddressCfxTransfer;
    }
    public buildQueryOptions({minEpochNumber, maxEpochNumber, txParas,
                                 minTimestamp, maxTimestamp,
                                 accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray,
                                 tokenId, txType, skip, limit, sort}){
        if(txType === CONST.TX_TYPE.CREATE){
            // page
            const queryOptions: any = {offset: skip, limit, raw: true};
            // condition
            const conditionArray = [];
            conditionArray.push({from: accountAddressId});
            conditionArray.push({value: { [Op.gt]: 0}});
            if(txParas) {
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

       return super.buildQueryOptions({minEpochNumber, maxEpochNumber, txParas,
            minTimestamp, maxTimestamp,
            accountAddressId, addressId, fromAddressId, toAddressId, opponentAddressId, tokenAddressIdArray,
            tokenId, txType, skip, limit, sort});
    }

    public buildQueryFields({accountAddressId, txType}): any{
        if(txType === CONST.TX_TYPE.CREATE){
            return [
                'epochNumber',
                ['txHash', 'transactionHash'],
                'from',
                'to',
                'value',
                ['blockTime', 'timestamp'],
            ];
        }

        return [
            ['epoch', 'epochNumber'],
            'blockIndex',
            'txIndex',
            'txLogIndex',
            'type',
            ['fromId', 'from'],
            ['toId', 'to'],
            'value',
            ['createdAt', 'timestamp'],
        ];
    }

    public async doQuery(options: any, queryOptions: any): Promise<any>{

        if(options.txType === CONST.TX_TYPE.CREATE){
            return await TraceCreateContract.findAndCountAll(queryOptions);
        }
        if(options.accountAddress !== undefined){
            if (Object.keys(queryOptions.where).length === 1) {
                // only query by address id
                if (options.useCountCache) {
                    return this.queryWithCache(queryOptions, options, );
                }
                const cacheCount = await getAddrTransferCount(queryOptions.where.addressId, CONST.TRANSFER_TYPE.CFX)
                const rows = await AddressCfxTransfer.findAll(queryOptions);
                return {count: Math.max(cacheCount, rows.length) , rows};
            }
            return await AddressCfxTransfer.findAndCountAll(queryOptions);
        }

        const pagedCondition = await this.buildPagedCfxTransferOptions(options.skip, options.limit);
        if(pagedCondition.where){
            queryOptions.where = {[Op.and]: [pagedCondition.where, queryOptions.where]};
            queryOptions.offset = pagedCondition.skip;
        }
        const rows = await CfxTransfer.findAll(queryOptions);
        const count =  await KV.getNumber(KEY_FULL_CFX_TRANSFER_COUNT);
        return {count: count || 0, rows: rows || []};
    }

    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
        txMap: Map<string, FullTransaction>): Promise<any>{
        row['transferType'] = CONST.TRANSFER_TYPE.CFX;
        return row;
    }

    private async buildPagedCfxTransferOptions(skip: number, limit: number){
        const pagedCondition: any = {};
        const cfxTransferPage = await pagingFullCfxTransfer(skip, limit);
        if (cfxTransferPage?.gtEpoch && cfxTransferPage?.id == Infinity) {
            pagedCondition.where = {
                epoch: {[Op.gt]: cfxTransferPage.gtEpoch},
            }
            pagedCondition.skip = skip;
        }
        if(cfxTransferPage && cfxTransferPage.id !== Infinity){
            pagedCondition.where = {
                [Op.and]: [
                    {
                        [Op.or]: [
                            {epoch: {[Op.lt]: cfxTransferPage.epoch}},
                            {
                                [Op.and]: [
                                    {epoch: cfxTransferPage.epoch},
                                    {id: {[Op.lte]: cfxTransferPage.dataId}},
                                ]
                            },
                        ]
                    },
                  // shrink order scope
                    {epoch: {[Op.gt]: cfxTransferPage.gtEpoch}}
                ]
            };
            pagedCondition.skip = cfxTransferPage.skip;
        }
        return pagedCondition;
    }

    public async doQueryAccountAddress(options: any, queryOptions: any): Promise<any> {
        throw new Errors.ParameterError(`${this.getTransferType()} no need count account address!`);
    }
}
