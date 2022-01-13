import {PruneType, PruneInfo} from "../../model/PruneInfo";
import {Op} from "sequelize";
import {StatApp} from "../../StatApp";
import {sleep} from "../tool/ProcessTool"
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {Token} from "../../model/Token";
import {KEY_PRUNE_CONFIG_SWITCH, KV} from "../../model/KV";
const lodash = require('lodash');

export abstract class PruneBase {
    public static KEEP_ROWS = 20_000;
    public static PRUNE_LOOP = 10_000;
    public static SLEEP_MS_PER_LOOP = 20;
    public static DEL_ROWS_PER_LOOP = 500;
    public static DEL_ROWS_MAX_PER_LOOP = 50_000;
    public static metrics = {
        sampling: 0,
    };

    protected TYPE_TOKEN_TRANSFER = new Set([PruneType.ERC20_TRANSFER, PruneType.ERC721_TRANSFER,
        PruneType.ERC1155_TRANSFER]);
    protected TYPE_ADDR_TOKEN_TRANSFER = new Set([PruneType.ADDR_ERC20_TRANSFER, PruneType.ADDR_ERC721_TRANSFER,
        PruneType.ADDR_ERC1155_TRANSFER]);

    protected app: StatApp;
    protected constructor(app: StatApp) {
        this.app = app;
    }

    protected abstract getModel(type: {type: string}): any;
    protected abstract buildBaseQuery({type, pruneParas}): {where: any, key: any};

    // overridable
    protected async maxOnePrune({type, where, keepRows}): Promise<any>{
        const model = this.getModel(type);
        return model.findOne(
            lodash.defaults({},{where: {...where}, order: [["epoch", "desc"]], offset: keepRows, limit: 1, raw: true})
        );
    }
    protected getPruneQuery({type, where, maxToPrune}){
        if(this.TYPE_TOKEN_TRANSFER.has(type)){
            return lodash.defaults({...where}, {id:{[Op.lte]: maxToPrune.id}});
        } else{
            return where;
        }
    }

    public async needPrune({type, pruneInfo}): Promise<boolean>{
        const {addressId} = pruneInfo;
        const keepRows = PruneBase.getKeepRowsByType(type);
        const pruneParas = PruneBase.getPruneParas({type, addressId});

        const {where} = this.buildBaseQuery({type, pruneParas});
        const maxToPrune = await this.maxOnePrune({type, where, keepRows});
        return maxToPrune !== null;
    }

    public async prune({type, pruneInfo}) {
        let {
            pruneLoop = PruneBase.PRUNE_LOOP,
            delRowsPerLoop = PruneBase.DEL_ROWS_PER_LOOP,
            sleepMsPerLoop = PruneBase.SLEEP_MS_PER_LOOP,
            addressId,
        } = pruneInfo;
        let veryStart = Date.now();
        let start = Date.now();
        const keepRows = PruneBase.getKeepRowsByType(type);
        const pruneParas = PruneBase.getPruneParas({type, addressId});
        const {where, key} = this.buildBaseQuery({type, pruneParas});
        const maxToPrune = await this.maxOnePrune({type, where, keepRows});
        if(maxToPrune === null){
            return;
        }
        const pruneWhere = this.getPruneQuery({type, where, maxToPrune});
        start = PruneBase.doMetricStep(type, 'queryMax', start);

        let countdownLoop = pruneLoop;
        let delTotal = 0;
        let delDelta = 0;
        do{
            if(await KV.getSwitch(KEY_PRUNE_CONFIG_SWITCH)){
                if(PruneBase.PRUNE_LOOP <= (pruneLoop - countdownLoop)) break;
                delRowsPerLoop = PruneBase.DEL_ROWS_PER_LOOP;
                sleepMsPerLoop = PruneBase.SLEEP_MS_PER_LOOP;
            }
            start = PruneBase.doMetricStep(type, 'getSwitch', start);

            const checkpoint = { position: maxToPrune.epoch };
            const pruneResult = await this.doPrune({type, where: pruneWhere, key, checkpoint, delRowsPerLoop});
            start = PruneBase.doMetricStep(type, 'doPrune', start);

            delDelta = pruneResult.delDelta;
            delTotal += delDelta;
            countdownLoop--;
            await sleep(sleepMsPerLoop);
            if (countdownLoop % 2 === 0) {
                console.log(`prune_pruneRlt[type=${type}][addressId=${addressId}],delTotal:${delTotal},time:${new Date()}`);
            }
            veryStart = PruneBase.doMetric(type, delDelta, veryStart);
        } while (delDelta>0 && (pruneLoop === 0 || countdownLoop>0))

        // update token's transfer
        await this.updateTransferCounter({type, addressId});
    }

    private async doPrune({type, where, key, checkpoint, delRowsPerLoop}): Promise<any>{
        const model = this.getModel(type);
        let delDelta = 0;
        let delCntr = 0;
        let pruneDb;
        let prune;
        await PruneInfo.sequelize.transaction(async (dbTx) => {
            let start = Date.now();
            pruneDb = await PruneInfo.findOne({
                where: { addressId: key.id, type: key.type},
                raw: true,
                transaction: dbTx
            });
            start = PruneBase.doMetricStep(type, 'findPrune', start);

            delCntr = pruneDb != null ? pruneDb.pruned : 0;
            delDelta = await model.destroy({
                where: lodash.defaults({...where}, {epoch:{[Op.lte]: checkpoint.position}}),
                limit: delRowsPerLoop,
                transaction: dbTx,
            });
            start = PruneBase.doMetricStep(type, 'destroy', start);

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
            PruneBase.doMetricStep(type, 'updatePrune', start);
        });
        return {delDelta, delCntr, prune, pruneDb};
    }

    private static doMetricStep(type, step, start){
        const runTimes = PruneBase.metrics[`${type}_${step}`];
        const elapsedTime = PruneBase.metrics[`${type}_${step}_ms`];
        const elapsedDelta = Date.now() - start;
        PruneBase.metrics[`${type}_${step}`] = runTimes === undefined ? 1 : runTimes + 1;
        PruneBase.metrics[`${type}_${step}_ms`] = elapsedTime === undefined ? elapsedDelta : (elapsedTime + elapsedDelta);
        return Date.now();
    }

    private static doMetric(type, delDelta, veryStart){
        const effectRows = PruneBase.metrics[type];
        const elapsedTime = PruneBase.metrics[`${type}_ms`];
        const elapsedDelta = Date.now() - veryStart;
        PruneBase.metrics[type] = effectRows === undefined ? delDelta : (effectRows + delDelta);
        PruneBase.metrics[`${type}_ms`] = elapsedTime === undefined ? elapsedDelta : (elapsedTime + elapsedDelta);

        PruneBase.metrics.sampling++;
        if(PruneBase.metrics.sampling % 100 === 0) {
            console.log(`prune_metrics,metrics:${JSON.stringify(PruneBase.metrics)}`);
            PruneBase.metrics = { sampling: 0 };
        }
        return Date.now();
    }

    private static getKeepRowsByType(type): number{
        let keepRows;
        switch (type) {
            case PruneType.BLOCK:
            case PruneType.TX:
            case PruneType.CFX_TRANSFER:
            case PruneType.ERC20_TRANSFER:
            case PruneType.ERC721_TRANSFER:
            case PruneType.ERC1155_TRANSFER:
                keepRows = PruneBase.KEEP_ROWS;
                break;
            case PruneType.MINER_BLOCK:
            case PruneType.ADDR_TX:
            case PruneType.ADDR_CFX_TRANSFER:
            case PruneType.ADDR_ERC20_TRANSFER:
            case PruneType.ADDR_ERC721_TRANSFER:
            case PruneType.ADDR_ERC1155_TRANSFER:
                keepRows = PruneBase.KEEP_ROWS;
                break;
            default:
                throw new Error(`unknown prune type:${type}`);
        }
        return keepRows;
    }

    private static getPruneParas({type, addressId}): any{
        const isTokenTransfer = type === PruneType.ERC20_TRANSFER
            || type === PruneType.ERC721_TRANSFER
            || type === PruneType.ERC1155_TRANSFER;
        const contractId = isTokenTransfer ? addressId : undefined;
        return {addressId, contractId};
    }

    protected async updateTransferCounter({type, addressId}){
        if (process.env.noUpdateTokenTransferCount) {
            return;
        }
        if(this.TYPE_TOKEN_TRANSFER.has(type)){
            const prunedRows = await PruneBase.getPrunedRows({type, addressId});
            if(prunedRows > 0){
                const storageRows = await PruneBase.getStorageRows({type, addressId});
                await Token.update({transfer: storageRows + prunedRows}, {where: {hex40id: addressId}});
            }
        }
    }

    private static async getPrunedRows({type, addressId}) {
        const prune = await PruneInfo.findOne({where: {addressId, type}});
        return prune !== null ? prune.pruned : 0;
    }

    private static async getStorageRows({type, addressId}) {
        let model;
        if(type === PruneType.ERC20_TRANSFER){
            model = Erc20Transfer;
        } else if (type === PruneType.ERC721_TRANSFER){
            model = Erc721Transfer;
        } else if (type === PruneType.ERC1155_TRANSFER){
            model = Erc1155Transfer;
        } else {
            return 0;
        }
        return model.count({where: {contractId: addressId}});
    }
}
