const lodash = require('lodash');
const CONST = require('./common/constant');
import {Epoch} from "../model/Epoch";
import {StatApp} from "../StatApp";
import {isRunning, sleep} from "./tool/ProcessTool";

export abstract class SyncBase{
    protected app: StatApp;
    private forwardQueue: PreloadMap;
    private backwardQueue: PreloadMap;

    protected constructor(app: StatApp) {
        this.app = app;
        this.forwardQueue = new PreloadMap(this);
        this.backwardQueue = new PreloadMap(this.getDataFromFullNode.bind(this));
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

    private async saveForward(epochNumber, { parentHash, modelData }) {
        const preEpochNumber = epochNumber - 1;
        const prevEpoch = await this.queryEpochFromDb(preEpochNumber);
        if (prevEpoch && parentHash !== prevEpoch.pivotHash) {
            throw new Error(`ParentEpochError: previous[epoch=${preEpochNumber},pivotHash="${prevEpoch.pivotHash}"]
            , current[epoch=${epochNumber},parentHash="${parentHash}"]`);
        }
        await this.saveDataToDb(epochNumber, modelData);
    }

    private async saveBackward(epochNumber, { pivotHash, modelData }) {
        const nextEpochNumber = epochNumber + 1;
        const nextEpoch = await this.queryEpochFromDb(nextEpochNumber);
        if (nextEpoch && pivotHash !== nextEpoch.parentHash) {
            throw new Error(`ParentEpochError: next[epoch=${nextEpochNumber}, parentHash="${nextEpoch.parentHash}"]
            , current[epoch=${epochNumber},pivotHash="${pivotHash}"]`);
        }
        await this.saveDataToDb(epochNumber, modelData);
    }

    private async syncForward(epochNumber) {
        try {
            const data: SyncData = await this.getDataForwardWithPreload(epochNumber);
            await this.saveForward(epochNumber, data);
            epochNumber += 1;
        } catch (e) {
            console.error(`sync_base forward sync error, epoch:${epochNumber}`, e);
            // TODO Ding_talk alert
            await this.forwardQueue.clear();
            epochNumber -= 1;
            await this.delDataFromDb(epochNumber).catch((err) => {
                console.error(`sync_base del end fail, epoch:${epochNumber}`, err);
                // TODO Ding_talk alert
                throw err;
            });
        }
        return epochNumber;
    }

    private async syncBackward(epochNumber) {
        try {
            const data: SyncData = await this.getDataBackwardWithPreload(epochNumber);
            await this.saveBackward(epochNumber, data);
            epochNumber -= 1;
        } catch (e) {
            console.error(`sync_base backward sync error, epoch:${epochNumber}`, e);
            // TODO Ding_talk alert
        }
        return epochNumber;
    }

    public async run(epochNumber) {
        const {
            app: { cfx, config },
        } = this;

        let traceEpochNumber = epochNumber;
        if(traceEpochNumber === undefined){
            traceEpochNumber = await this.queryNextEpochFromDb();
        }

        while (isRunning()) {
            const stateEpochNumber = await cfx.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);
            if (traceEpochNumber <= stateEpochNumber - config.preload) {
                traceEpochNumber = await this.syncForward(traceEpochNumber);
            } else {
                await sleep(1000);
            }
        }
    }

    public async queryNextEpochFromDb(){
        let maxEpochNumber:number = await Epoch.max('id')
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    public async queryEpochFromDb(epochNumber){
        return await Epoch.findOne({where:{id:epochNumber}});
    }

    public abstract getDataFromFullNode(epochNumber): Promise<SyncData>;

    public abstract saveDataToDb(epochNumber, data);

    public abstract delDataFromDb(epochNumber);
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

export class SyncData {
    parentHash: string;
    pivotHash: string;
    modelData: any;
}

