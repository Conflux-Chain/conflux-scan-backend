import {PruneType, PruneInfo} from "../../model/PruneInfo";
import {Op} from "sequelize";
import {StatApp} from "../../StatApp";
const lodash = require('lodash');

export abstract class PruneBase {
    public static DEL_ROWS_PER_LOOP = 1_000;

    protected TYPE_TOKEN_TRANSFER = new Set([PruneType.ERC20_TRANSFER, PruneType.ERC721_TRANSFER,
        PruneType.ERC1155_TRANSFER]);
    protected TYPE_ADDR_TOKEN_TRANSFER = new Set([PruneType.ADDR_ERC20_TRANSFER, PruneType.ADDR_ERC721_TRANSFER,
        PruneType.ADDR_ERC1155_TRANSFER]);

    protected app: StatApp;
    protected constructor(app: StatApp) {
        this.app = app;
    }

    protected abstract validateParas({type, pruneParas}): boolean;
    protected abstract getModel(type: {type: string}): any;
    protected abstract buildBaseQuery({type, pruneParas}): {where: any, key: any};

    // overridable
    protected async maxOnePrune({type, where, keepRows}): Promise<any>{
        const model = this.getModel(type);
        return model.findOne(
            lodash.defaults({},{where: {...where}, order: [["epoch", "desc"]], offset: keepRows, limit: 1, raw: true})
        );
    }

    public async prune(
        {
            type,
            keepRows,
            pruneParas,
            delRowsPerLoop = PruneBase.DEL_ROWS_PER_LOOP,
        }:
            {
                type: string,
                keepRows: number,
                pruneParas: any,
                delRowsPerLoop?: number,
            }) {
        if(!this.validateParas({type, pruneParas})){
            return;
        }

        const {where, key} = this.buildBaseQuery({type, pruneParas});
        const maxToPrune = await this.maxOnePrune({type, where, keepRows});
        if(maxToPrune === null){
            return;
        }

        let delDelta = 0;
        let maxLoop = 10;
        do{
            const checkpoint = { position: maxToPrune.epoch };
            const pruneResult = await this.doPrune({type, where, key, checkpoint, delRowsPerLoop});
            // console.log(`prune_pruneRlt[type=${type}],result:${JSON.stringify(pruneResult)}`);
            delDelta = pruneResult.delDelta;
            maxLoop--;
        } while (delDelta>0 && maxLoop>0)
    }

    private async doPrune({type, where, key, checkpoint, delRowsPerLoop}): Promise<any>{
        const model = this.getModel(type);
        let delDelta = 0;
        let delCntr = 0;
        let pruneDb;
        let prune;
        await PruneInfo.sequelize.transaction(async (dbTx) => {
            pruneDb = await PruneInfo.findOne({
                where: { addressId: key.id, type: key.type},
                raw: true,
                transaction: dbTx
            });
            delCntr = pruneDb != null ? pruneDb.pruned : 0;
            delDelta = await model.destory({
                where: lodash.defaults({...where}, {epoch:{[Op.lte]: checkpoint.position}}),
                limit: delRowsPerLoop,
                transaction: dbTx,
            });

            prune = {
                addressId: key.id,
                type: key.type,
                pruned: delCntr + delDelta,
                epoch: checkpoint.position
            };
            if(pruneDb === null){
                await PruneInfo.create(prune, {transaction:dbTx});
                return;
            }

            await PruneInfo.update(prune, {
                where: {id: pruneDb.id, pruned: pruneDb.pruned},
                transaction: dbTx
            });
        });
        return {delDelta, delCntr, prune, pruneDb};
    }
}