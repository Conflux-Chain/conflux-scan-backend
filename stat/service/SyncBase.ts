const lodash = require('lodash');
const CONST = require('./common/constant');
import {Epoch} from "../model/Epoch";
import {StatApp} from "../StatApp";

export abstract class SyncBase{
    protected app: StatApp;
    private forwardQueue: PreloadMap;
    private backwardQueue: PreloadMap;

    protected constructor(app: StatApp) {
        this.app = app;
        this.forwardQueue = new PreloadMap(this.getData.bind(this));
        this.backwardQueue = new PreloadMap(this.getData.bind(this));
    }

    private async getDataForwardWithPreload(epochNumber): Promise<SyncData> {
        const {
            app: { cfx, config },
        } = this;

        const stateEpochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);
        lodash.range(config.preload).forEach((i) => {
            if (epochNumber + i < stateEpochNumber) {
                this.forwardQueue.start(epochNumber + i);
            }
        });
        return this.forwardQueue.pop(epochNumber);
    }

    private async getDataBackwardWithPreload(epochNumber): Promise<SyncData> {
        const {
            app: { config },
        } = this;

        lodash.range(config.preload).forEach((i) => {
            if (epochNumber - i >= 0) {
                this.backwardQueue.start(epochNumber - i);
            }
        });
        return this.backwardQueue.pop(epochNumber);
    }

    private async saveForward(epochNumber, { parentHash, modelData }): Promise<SyncCode> {
        const preEpochNumber = epochNumber - 1;
        const prevEpoch = await this.getEpochByEpochNumber(preEpochNumber);
        const validate = await this.validate(epochNumber, modelData);
        if (prevEpoch && parentHash !== prevEpoch.pivotHash || !validate) {
            return SyncCode.PIVOT_SWITCH;
        }
        await this.save(epochNumber, modelData);
        return SyncCode.SUCCESS;
    }

    private async saveBackward(epochNumber, { pivotHash, modelData }): Promise<SyncCode> {
        const nextEpochNumber = epochNumber + 1;
        const nextEpoch = await this.getEpochByEpochNumber(nextEpochNumber);
        // useful only when sync backward
        // if (nextEpoch && pivotHash !== nextEpoch.parentHash) {
        //     return SyncCode.PIVOT_SWITCH;
        // }
        await this.save(epochNumber, modelData);
        return SyncCode.SUCCESS;
    }

    private async syncForward(epochNumber) {
        let syncCode;
        let data: SyncData;
        try {
            data = await this.getDataForwardWithPreload(epochNumber);
            syncCode = await this.saveForward(epochNumber, data);
        } catch (error) {
            console.error(`sync_base sync forward error, epoch:${epochNumber}`, error);
            throw error;  //ECONNREFUSED
        }

        if(syncCode === SyncCode.SUCCESS){
            epochNumber += 1;
        }
        if(syncCode === SyncCode.PIVOT_SWITCH){
            await this.forwardQueue.clear();
            epochNumber -= 1;
            await this.delete(epochNumber, data.modelData).catch((error) => {
                console.error(`sync_base del end error, epoch:${epochNumber}`, error);
                throw error;
            });
        }
        return epochNumber;
    }

    private async syncBackward(epochNumber) {
        let syncCode;
        try {
            const data: SyncData = await this.getDataBackwardWithPreload(epochNumber);
            syncCode = await this.saveBackward(epochNumber, data);
        } catch (error) {
            console.error(`sync_base sync backward error, epoch:${epochNumber}`, error);
        }

        if(syncCode === SyncCode.SUCCESS){
            epochNumber -= 1;
        }
        return epochNumber;
    }

    public async run(epochNumber) {
        const {
            app: { cfx, config },
        } = this;
        if (!Number.isInteger(config.preload)) {
            console.log(` SyncBase uses default preload value: 16.`)
            config.preload = 16
        }
        const next = await this.getNextEpochNumber();

        let traceEpochNumber = epochNumber;
        if(traceEpochNumber === undefined || traceEpochNumber <= next){
            traceEpochNumber = next;
        }

        const that = this
        async function repeat() {
            const stateEpochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);
            if (traceEpochNumber <= stateEpochNumber - (config.preload)) {
                traceEpochNumber = await that.syncForward(traceEpochNumber);
                setTimeout(repeat, 0)
            } else {
                setTimeout(repeat, 1000)
            }
        }
        return repeat()
    }

    public async getNextEpochNumber(){
        let maxEpochNumber:number = await Epoch.max('epoch')
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    public async getEpochByEpochNumber(epochNumber){
        return await Epoch.findOne({where:{epoch: epochNumber}});
    }

    //-------------------- methods subclass to implement ---------------------
    public abstract getData(epochNumber): Promise<SyncData>;

    public abstract validate(epochNumber, modelData): Promise<boolean>;

    public abstract save(epochNumber, modelData);

    public abstract delete(epochNumber, modelData);
}

export class SyncData {
    parentHash: string;
    pivotHash: string;
    modelData: any;
}

export class PreloadMap extends Map {
    private func: any;
    constructor(func) {
        super();
        this.func = func;
    }

    public start(arg) {
        if (!this.has(arg)) {
            this.set(arg, this.func(arg).catch((e) => e));
        }
        return this.get(arg);
    }

    public async pop(arg) {
        const task = this.start(arg);
        this.delete(arg);

        const value = await task;
        if (value instanceof Error) {
            throw value;
        }
        return value;
    }
}

enum SyncCode {
    SUCCESS,
    FAILURE,
    PIVOT_SWITCH,
}
