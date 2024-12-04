import {CONST} from "../common/constant";
import {FullBlock} from "../../model/FullBlock";
import {EpochTaskTokenTransfer} from "../../TokenTransferSync";
import {Epoch} from "../../model/Epoch";
import {PosBlock} from "../../model/PoS";
import {Errors} from "../common/LogicError";
import {EpochHashCfxTransfer} from "../../CfxTransferSync";

export interface IMetric {
    tags: {syncType: string},
    fields:{
        latestSynced: number,
        latestReached: number,
        syncGap: number,
    }
}

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

    public async sample(): Promise<IMetric>{
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
// measure chain growth
export class RpcSampler extends Sampler{

    previousState:Promise<number>;

    public constructor(app: any) {
        super(app);
        this.updateState();
    }

    protected getType(): string {
        return SamplerType.RPC;
    }

    protected async getLatestSynced(): Promise<number> {
        const ret = this.previousState;
        this.updateState();
        return ret;
    }

    private updateState() {
        this.previousState = this.getLatestState();
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
        return EpochHashCfxTransfer.findOne({order: [['epoch', 'desc']]})
            .then(max => max?.epoch);
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
    RPC = 'rpc',
    CFX_TRANSFER = 'cfxTransfer',
    TOKEN_TRANSFER = 'tokenTransfer',
    EPOCH_MISC = 'epochMisc',
    POS_BLOCK = 'posBlock',
}
