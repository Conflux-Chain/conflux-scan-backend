// @ts-ignore
import {format} from "js-conflux-sdk";
import {FullMinerBlock} from "../model/FullMinerBlock";
import {SyncBase, SyncData} from "./SyncBase";
import {StatApp} from "../StatApp";
import {makeId} from "../model/HexMap";
import {fmtDtUTC} from "../model/Utils";
import {Op} from "sequelize";

export class MinerBlockSync extends SyncBase{
    protected app;

    constructor(app: StatApp) {
        super(app);
        this.app = app;
    }

    //----------------- implementation method from SyncBase -----------------
    async getDataFromFullNode(epochNumber): Promise<SyncData> {
        return await this.getMinerBlockArray(epochNumber);
    }

    async delDataFromDb(epochNumber, modelData) {
        const minerIdSet = new Set();
        modelData.forEach(item => {minerIdSet.add(item.minerId)});
        await FullMinerBlock.destroy({where: {[Op.and]: [
            {minerId: {[Op.in]: Array.from(minerIdSet)}},
            {epoch: epochNumber}]}
        });
    }

    async saveDataToDb(epochNumber, modelData) {
        await FullMinerBlock.sequelize.transaction(async (dbTx) => {
            await FullMinerBlock.bulkCreate(modelData, {transaction: dbTx});
        });
        if (epochNumber % 100 === 0) {
            console.log(`${fmtDtUTC(new Date())} insert ${modelData?.length} full_miner_block at epoch:${epochNumber}`)
        }
        return Promise.resolve();
    }

    public async queryNextEpochFromDb(){
        let maxEpochNumber:number = await FullMinerBlock.max('epoch')
        return maxEpochNumber ? (maxEpochNumber + 1) : 0;
    }

    //---------------------- business method for epoch -----------------------
    private async getMinerBlockArray(epochNumber) {
        const {
            app: { cfx },
        } = this;

        const blockHashArray = await cfx.getBlocksByEpochNumber(epochNumber);
        const blockArray = await Promise.all(blockHashArray.map(async (hash) => {
            return await cfx.getBlockByHash(hash, false)
        }));
        const minerBlockArray = await Promise.all(blockArray.map(async (block: any, position) => {
            const hex40 = format.hexAddress(block.miner);
            const blockDt = new Date(block.timestamp * 1000);
            const hex40Id = (await makeId(hex40, undefined, {dt: blockDt})).id;
            return {minerId: hex40Id, epoch: block.epochNumber, position, createdAt: blockDt};
        }));
        const pivotBlock: any = blockArray[blockArray.length - 1];
        let pivotHash = pivotBlock.hash.substr(2);
        let parentHash = pivotBlock.parentHash.substr(2);

        return {
            parentHash,
            pivotHash,
            modelData: minerBlockArray,
        };
    }
}
