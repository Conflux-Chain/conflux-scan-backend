import {PruneBase} from "./PruneBase";
import {StatApp} from "../../StatApp";
import {PruneType} from "../../model/PruneInfo";
import {AddressTransactionIndex, FullTransaction} from "../../model/FullBlock";

export class PruneTransaction extends PruneBase {
    protected app: StatApp;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
    }

    public getModel(type): any{
        let model;
        switch (type) {
            case PruneType.TX:
                model = FullTransaction;
                break;
            case PruneType.ADDR_TX:
                model = AddressTransactionIndex;
                break;
            default:
                throw new Error(`unknown prune type:${type}`);
        }
        return model;
    }

    public buildBaseQuery({type, pruneParas}): { where: any; key: any } {
        const {addressId, contractId} = pruneParas;
        if (PruneType.ADDR_TX === type) {
            return {where: {addressId}, key: {id: addressId, type}};
        }
        return {where: undefined, key: {id: 0, type} };
    }
}