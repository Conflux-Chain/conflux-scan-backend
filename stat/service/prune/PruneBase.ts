import {PruneType, PruneInfo} from "../../model/PruneInfo";
import {Op} from "sequelize";
import {StatApp} from "../../StatApp";
import {sleep} from "../tool/ProcessTool"
const lodash = require('lodash');

export abstract class PruneBase {
    public static PRUNE_LOOP = 10000;
    public static DEL_ROWS_PER_LOOP = 500;
    public static SLEEP_MS_PER_LOOP = 20;

    protected TYPE_TOKEN_TRANSFER = new Set([PruneType.ERC20_TRANSFER, PruneType.ERC721_TRANSFER,
        PruneType.ERC1155_TRANSFER]);
    protected TYPE_ADDR_TOKEN_TRANSFER = new Set([PruneType.ADDR_ERC20_TRANSFER, PruneType.ADDR_ERC721_TRANSFER,
        PruneType.ADDR_ERC1155_TRANSFER]);

    protected metrics = {
        total_ms : 0,
    }

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
            pruneLoop = PruneBase.PRUNE_LOOP,
            delRowsPerLoop = PruneBase.DEL_ROWS_PER_LOOP,
            sleepMsPerLoop = PruneBase.SLEEP_MS_PER_LOOP,
        }:
            {
                type: string,
                keepRows: number,
                pruneParas: any,
                pruneLoop?:number,
                delRowsPerLoop?: number,
                sleepMsPerLoop?: number,
            }) {
        let start = Date.now();
        if(!this.validateParas({type, pruneParas})){
            return;
        }

        const {where, key} = this.buildBaseQuery({type, pruneParas});
        const maxToPrune = await this.maxOnePrune({type, where, keepRows});
        if(maxToPrune === null){
            return;
        }

        const unlimitedLoop = pruneLoop === 0;
        let delTotal = 0;
        let delDelta = 0;
        do{
            const checkpoint = { position: maxToPrune.epoch };
            const pruneResult = await this.doPrune({type, where, key, checkpoint, delRowsPerLoop});
            delDelta = pruneResult.delDelta;
            delTotal += delDelta;
            pruneLoop--;
            await sleep(sleepMsPerLoop);
            if (delTotal % 10000 === 0) {
                console.log(`prune_pruneRlt[type=${type}][addressId=${key.id}],delTotal:${delTotal},time:${new Date()}`);
            }
        } while (delDelta>0 && (unlimitedLoop || pruneLoop>0))

        let end = Date.now();
        const elapsed = end - start;
        this.metrics.total_ms += elapsed;
        this.doMetric(type, delTotal, elapsed);
        console.log(`prune_metrics[type=${type}],metrics:${JSON.stringify(this.metrics)}`);
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
            delDelta = await model.destroy({
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

    private doMetric(type, delDelta, elapsedDelta){
        const effectRows = this.metrics[type];
        const elapsedTime = this.metrics[`${type}_ms`];
        this.metrics[type] = effectRows === undefined ? delDelta : (effectRows + delDelta);
        this.metrics[`${type}_ms`] = elapsedTime === undefined ? elapsedDelta : (elapsedTime + elapsedDelta);
    }
}
