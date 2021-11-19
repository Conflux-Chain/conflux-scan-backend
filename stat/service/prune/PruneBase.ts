import {PruneType, PruneInfo} from "../../model/PruneInfo";
import {Op} from "sequelize";
import {StatApp} from "../../StatApp";
import {sleep} from "../tool/ProcessTool"
import {Erc20Transfer} from "../../model/Erc20Transfer";
import {Erc721Transfer} from "../../model/Erc721Transfer";
import {Erc1155Transfer} from "../../model/Erc1155Transfer";
import {Token} from "../../model/Token";
const lodash = require('lodash');

export abstract class PruneBase {
    public static KEEP_ROWS = 20_000;
    public static PRUNE_LOOP = 10_000;
    public static SLEEP_MS_PER_LOOP = 20;
    public static DEL_ROWS_PER_LOOP = 500;
    public static DEL_ROWS_MAX_PER_LOOP = 5_000;
    public static metrics = {
        total_ms : 0,
    }

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

    public async needPrune({type, pruneInfo}): Promise<boolean>{
        const {addressId} = pruneInfo;
        const keepRows = PruneBase.getKeepRowsByType(type);
        const pruneParas = PruneBase.getPruneParas({type, addressId});

        const {where} = this.buildBaseQuery({type, pruneParas});
        const maxToPrune = await this.maxOnePrune({type, where, keepRows});
        return maxToPrune !== null;
    }

    public async prune({type, pruneInfo}) {
        const {
            pruneLoop = PruneBase.PRUNE_LOOP,
            delRowsPerLoop = PruneBase.DEL_ROWS_PER_LOOP,
            sleepMsPerLoop = PruneBase.SLEEP_MS_PER_LOOP,
            addressId,
        } = pruneInfo;
        const keepRows = PruneBase.getKeepRowsByType(type);
        const pruneParas = PruneBase.getPruneParas({type, addressId});

        let start = Date.now();
        const {where, key} = this.buildBaseQuery({type, pruneParas});
        const maxToPrune = await this.maxOnePrune({type, where, keepRows});
        if(maxToPrune === null){
            return;
        }

        const unlimitedLoop = pruneLoop === 0;
        let loop = pruneLoop;
        let delTotal = 0;
        let delDelta = 0;
        do{
            const checkpoint = { position: maxToPrune.epoch };
            const pruneResult = await this.doPrune({type, where, key, checkpoint, delRowsPerLoop});
            delDelta = pruneResult.delDelta;
            delTotal += delDelta;
            loop--;
            await sleep(sleepMsPerLoop);
            if (delTotal % 10000 === 0) {
                console.log(`prune_pruneRlt[type=${type}][addressId=${addressId}],delTotal:${delTotal},time:${new Date()}`);
            }
        } while (delDelta>0 && (unlimitedLoop || loop>0))

        // update token's transfer
        await this.updateTransferCounter({type, addressId});

        let end = Date.now();
        const elapsed = end - start;
        PruneBase.metrics.total_ms += elapsed;
        PruneBase.doMetric(type, delTotal, elapsed);
        console.log(`prune_metrics[type=${type}][addressId=${addressId}],metrics:${JSON.stringify(PruneBase.metrics)}`);
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

    private static doMetric(type, delDelta, elapsedDelta){
        const effectRows = PruneBase.metrics[type];
        const elapsedTime = PruneBase.metrics[`${type}_ms`];
        PruneBase.metrics[type] = effectRows === undefined ? delDelta : (effectRows + delDelta);
        PruneBase.metrics[`${type}_ms`] = elapsedTime === undefined ? elapsedDelta : (elapsedTime + elapsedDelta);
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

    private async updateTransferCounter({type, addressId}){
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
