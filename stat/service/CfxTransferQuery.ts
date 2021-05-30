import {CfxTransfer, pagingFullCfxTransfer, AddressCfxTransfer} from "../model/CfxTransfer";
import {TransferQueryBase} from "./TransferQueryBase";
import {KEY_FULL_CFX_TRANSFER_COUNT, KV} from "../model/KV";
import {pagingFullTx} from "../model/FullBlock";
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

    public buildQueryFields(): any{
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

    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
                              contractInfoMap: Map<number, object>, tokenInfoMap: Map<number, object>): Promise<any>{
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
                            {dataId: {[Op.lt]: cfxTransferPage.dataId}},
                        ]},
                ]
            };
            pagedCondition.skip = cfxTransferPage.skip;
        }
        return pagedCondition;
    }
}
