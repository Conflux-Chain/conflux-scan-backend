import {CONST} from "../common/constant";
import {FullBlock} from "../../model/FullBlock";
import {TaskCfxTransfer} from "../../CfxTransferSync";
import {EpochTaskTokenTransfer} from "../../TokenTransferSync";
import {Epoch} from "../../model/Epoch";
import {PosBlock} from "../../model/PoS";
import {Errors} from "../common/LogicError";

export abstract class Sampler {

    protected app: any;

    protected constructor(app: any) {
        this.app = app;
    }

    protected async getLatestState(): Promise<number> {
        const {
            app: { cfx },
        } = this;

        return cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);
    }

    public async sample(): Promise<any>{
        const [latestSynced, latestReached] = await Promise.all([
            this.getLatestSynced(),
            this.getLatestState()
        ])
        if(latestSynced === undefined || latestReached === undefined){
            throw new Errors.BizError(`[alert]scanSyncMonitor sample error,sampler:${this.getType()},latestSynced:${latestSynced},latestReached:${latestReached}`);
        }

        const syncGap = latestReached - latestSynced;
        const point = {
            tags:{
                syncType: this.getType(),
            },
            fields:{
                latestSynced,
                latestReached,
                syncGap,
            }
        };
        return point;
    }

    protected abstract getType(): string;

    protected abstract getLatestSynced(): Promise<number>;

}

//------------------------------------------------------------------------
export class BlockTxSampler extends Sampler{

    public constructor(app: any) {
        super(app);
    }

    protected getType(): string {
        return SamplerType.BLOCK_TX;
    }

    protected async getLatestSynced(): Promise<number> {
        return FullBlock.findOne({order: [['epoch', 'desc']]})
            .then(max => max?.epoch);
    }
}

//------------------------------------------------------------------------
export class CfxTransferSampler extends Sampler{

    public constructor(app: any) {
        super(app);
    }

    protected getType(): string {
        return SamplerType.CFX_TRANSFER;
    }

    protected async getLatestSynced(): Promise<number> {
        return TaskCfxTransfer.findOne({order: [['epoch', 'desc']]})
            .then(max => max?.cursor);
    }
}

//------------------------------------------------------------------------
export class TokenTransferSampler extends Sampler{

    public constructor(app: any) {
        super(app);
    }

    protected getType(): string {
        return SamplerType.TOKEN_TRANSFER;
    }

    protected async getLatestSynced(): Promise<number> {
        return EpochTaskTokenTransfer.findOne({order: [['epoch', 'desc']]})
            .then(max => max?.cursor);
    }
}

//------------------------------------------------------------------------
export class EpochMiscSampler extends Sampler{

    public constructor(app: any) {
        super(app);
    }

    protected getType(): string {
        return SamplerType.EPOCH_MISC;
    }

    protected async getLatestSynced(): Promise<number> {
        return Epoch.findOne({order: [['epoch', 'desc']]})
            .then(max => max?.epoch);
    }
}

//------------------------------------------------------------------------
export class PosBlockSampler extends Sampler{

    public constructor(app: any) {
        super(app);
    }

    protected getType(): string {
        return SamplerType.POS_BLOCK;
    }

    protected async getLatestSynced(): Promise<number> {
        return PosBlock.findOne({order: [['height', 'desc']]})
            .then(max => max?.height);
    }

    protected async getLatestState(): Promise<number> {
        const {
            app: { cfx },
        } = this;

        return cfx.pos.getStatus().then(status => status.latestCommitted);
    }
}

export enum SamplerType {
    BLOCK_TX = 'blockTx',
    CFX_TRANSFER = 'cfxTransfer',
    TOKEN_TRANSFER = 'tokenTransfer',
    EPOCH_MISC = 'epochMisc',
    POS_BLOCK = 'posBlock',
}
