import {Epoch} from "../model/Epoch";
import {SyncBase, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {fmtDtUTC} from "../model/Utils";
const lodash = require('lodash');

export class EpochSync extends SyncBase{
    protected app;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from SyncBase -----------------
    async getDataFromFullNode(epochNumber): Promise<SyncData> {
        const data = await this.getEpochByEpochNumber(epochNumber);
        const syncData = {
            parentHash: data.parentHash,
            pivotHash: data.pivotHash,
            modelData: data,
        };
        return syncData;
    }

    async delDataFromDb(epochNumber, modelData) {
        await Epoch.destroy({where:{epoch: epochNumber}});
    }

    async saveDataToDb(epochNumber, modelData) {
        const newRecord = await Epoch.add(modelData);
        if (epochNumber % 100 === 0) {
            console.log(`${fmtDtUTC(new Date())} insert full_epoch at epoch:${epochNumber}`)
        }
        return Promise.resolve(newRecord);
    }

    //---------------------- business method for epoch -----------------------
    private async getEpochByEpochNumber(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const pivotBlock = await cfx.getBlockByEpochNumber(epochNumber, false);
        pivotBlock.timestamp = Number(pivotBlock.timestamp);
        const now = Math.floor(Date.now() / 1000);
        const timestamp = lodash.min([pivotBlock.timestamp, now]);// XXX: for filter negative timestamp

        return {
            epoch: epochNumber,
            pivotHash: pivotBlock.hash.substr(2),
            parentHash: pivotBlock.parentHash.substr(2),
            timestamp: new Date(timestamp * 1000),
        };
    }
}
