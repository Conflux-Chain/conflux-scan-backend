import {CfxTransfer} from "../model/CfxTransfer";
import {TransferQueryBase} from "./TransferQueryBase";
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
    public async doQuery(options: any): Promise<any>{
        return await CfxTransfer.findAndCountAll(options);
    }
    public processQueryResult(row, hex40Map: Map<number, string>, hex64Map: Map<number, string>,
                              contractInfoMap: Map<number, object>, tokenInfoMap: Map<number, object>): Promise<any>{
        row['transferType'] = CONST.TRANSFER_TYPE.CFX;
        return row;
    }
}
