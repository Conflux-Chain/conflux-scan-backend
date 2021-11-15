import {PruneBase} from "./PruneBase";
import {StatApp} from "../../StatApp";
import {PruneType} from "../../model/PruneInfo";
import {FullBlock} from "../../model/FullBlock";
import {FullMinerBlock} from "../../model/FullMinerBlock";

export class PruneBlock extends PruneBase {
    protected app: StatApp;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
    }

    public validateParas({type, pruneParas}): boolean {
        const {addressId, contractId} = pruneParas;
        if (PruneType.BLOCK !== type && PruneType.MINER_BLOCK !== type) return false;
        if (PruneType.MINER_BLOCK === type && !addressId) return false;
        return true;
    }

    public getModel(type): any{
        let model;
        switch (type) {
            case PruneType.BLOCK:
                model = FullBlock;
                break;
            case PruneType.MINER_BLOCK:
                model = FullMinerBlock;
                break;
            default:
                throw new Error(`unknown prune type:${type}`);
        }
        return model;
    }

    public buildBaseQuery({type, pruneParas}): { where: any; key: any } {
        const {addressId, contractId} = pruneParas;
        if (PruneType.MINER_BLOCK === type) {
            return {where: {minerId: addressId}, key: {id: addressId, type}};
        }
        return {where: undefined, key: {id: 0, type} };
    }
}