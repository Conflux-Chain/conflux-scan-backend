// Notice: The first stat info bucket that is the oldest one will be persisted into db before the third stat
// info bucket will be generated. So there are two stat info bucket exist at most for each token address.
// Format: business stat info
// {
//      currentEpochNumber: 20698703,
//      currentEpochTimestamp: '2021-12-12 10:11:22',
//      notifyCounter: 0,
//      statRecords:{
//          addressId:
//          [
//              {
//                  bizValue0: 8792,
//                  bizValue1: 5838,
//                  upperBoundIncluded: 2021-12-09 00:00:00,
//                  lowerBoundExcluded: 2021-12-09 00:01:00,
//                  minEpochNumber: 20697260,
//                  maxEpochNumber: 20698703,
//              },
//          ],
//      }
// }
import {Epoch} from "../../model/Epoch";

export class BizStatInfo {
    currentEpochNumber: number;
    currentEpochTimestamp: Date;
    epochCounter: number;
    statRecords: {};

    public constructor() {
        this.currentEpochNumber = 0;
        this.epochCounter = 0;
        this.statRecords = {};
    }

    public counter({epochNumber, epochTimestamp}) {
        this.currentEpochNumber = epochNumber;
        this.currentEpochTimestamp = epochTimestamp;
        this.epochCounter = this.epochCounter === undefined ? 1 : (this.epochCounter + 1)
    }

    public async trigger() {
        const interval = 500;
        let fire = this.epochCounter && this.epochCounter % interval === 0;
        if (!fire) {
            const latestEpoch = await Epoch.findOne({order: [['epoch', 'desc']], limit: 1});
            fire = latestEpoch && latestEpoch.epoch % interval === 0;
        }
        return fire;
    }
}