// @ts-ignore
import {format} from "js-conflux-sdk";
import {Epoch} from "../model/Epoch";
import {SyncBase, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
const lodash = require('lodash');

export class EpochSync extends SyncBase{
    protected app;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from  SyncBase -----------------
    async getDataFromFullNode(epochNumber): Promise<SyncData> {
        const data = await this.getEpochByEpochNumber(epochNumber);
        const syncData = {
            parentHash: data.parentHash,
            pivotHash: data.pivotHash,
            modelData: data,
        };
        return syncData;
    }

    async delDataFromDb(epochNumber) {
        await Epoch.destroy({where:{id: epochNumber}});
    }

    async saveDataToDb(epochNumber, modelData) {
        await Epoch.add(modelData);
    }

    //---------------------- business method for epoch -----------------------
    private async getEpochByEpochNumber(epochNumber) {
        const {
            app: { cfx, ttlMap },
        } = this;

        const result = await cfx.getBlockByEpochNumber(epochNumber, false);
        const pivotBlock = this.parseBlock(result);
        const now = Math.floor(Date.now() / 1000);

        return {
            epochNumber,
            pivotHash: pivotBlock.hash,
            parentHash: pivotBlock.parentHash,
            timestamp: lodash.min([pivotBlock.timestamp, now]), // XXX: for filter negative timestamp
        };
    }

    private parseBlock(block, detail = false) {
        if (block.epochNumber) {
            block.epochNumber = Number(block.epochNumber);
        }
        block.timestamp = Number(block.timestamp);
        block.miner = format.hexAddress(block.miner);
        block.size = BigInt(block.size || 0);
        block.difficulty = BigInt(block.difficulty || 0);
        if (detail) {
            block.transactions.forEach((transaction) => {
                transaction.from = format.hexAddress(transaction.from);
                if (transaction.to) {
                    transaction.to = format.hexAddress(transaction.to);
                }
                if (transaction.contractCreated) {
                    transaction.contractCreated = format.hexAddress(transaction.contractCreated);
                }
                if (transaction.status) {
                    transaction.status = Number(transaction.status);
                }
                transaction.gasPrice = BigInt(transaction.gasPrice || 0);
            });
        }
        return block;
    }
}
