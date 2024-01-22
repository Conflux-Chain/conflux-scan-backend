import {ScanApp} from "./index";

const lodash = require('lodash');
const BigFixed = require('bigfixed');

export class StatisticService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
  }

  async dag({ limit = 10 } = {}) {
    const {
      app: { CONST, service },
    } = this;

    const epochNumber = await service.conflux.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_STATE);

    const matrix = await Promise.all(lodash.range(limit).map(async (index) => {
      const blockHashArray = await service.conflux.getBlocksByEpochNumber(epochNumber - index);
      const blockArray = await Promise.all(blockHashArray.map((hash) => service.conflux.getBlockByHash(hash)));
      return [...blockArray].reverse(); // FIXME: not reverse any more
    }));

    return {
      total: epochNumber,
      list: matrix,
    };
  }

  // ==========================================================================
  _diff(list) {
    list = list.map((each) => lodash.mapValues(each, BigFixed));
    const difference = {
      tps: BigFixed(0),
      blockTime: BigFixed(0),
      blockSize: BigFixed(0),
      difficulty: BigFixed(0),
      hashRate: BigFixed(0),
    } as any;

    const array = [];
    for (let i = 0; i < list.length - 1; i += 1) {
      const previous = list[i];
      const current = list[i + 1];

      difference.timestampDelta = (current.timestamp).sub(previous.timestamp);
      difference.blockDelta = (current.blockCount).sub(previous.blockCount);
      difference.transactionDelta = (current.transactionCount).sub(previous.transactionCount);
      difference.blockSizeDelta = (current.blockSizeCount).sub(previous.blockSizeCount);
      difference.blockDifficultyDelta = (current.blockDifficultyCount).sub(previous.blockDifficultyCount);
      difference.transactionGasPriceDelta = (current.transactionGasPriceCount).sub(previous.transactionGasPriceCount);

      if (!difference.timestampDelta.isZero()) {
        difference.tps = (difference.transactionDelta).div(difference.timestampDelta);
      }
      if (!difference.blockDelta.isZero()) {
        difference.blockTime = (difference.timestampDelta).div(difference.blockDelta);
        difference.blockSize = (difference.blockSizeDelta).div(difference.blockDelta);
        difference.difficulty = (difference.blockDifficultyDelta).div(difference.blockDelta);
      }
      if (!difference.transactionDelta.isZero()) {
        difference.transactionGasPrice = (difference.transactionGasPriceDelta).div(difference.transactionDelta);
      }
      if (!difference.blockTime.isZero()) {
        difference.hashRate = (difference.difficulty).div(difference.blockTime);
      }

      array.push({ ...current, ...difference }); // shallow copy
    }

    return array;
  }

  async plot({ interval, limit = 1 } = {} as any) {
    const {
      app: { /*syncSDK, */service },
    } = this;

    // const rdbSwitch = await KV.getSwitch(KEY_BLOCK_DATA_STAT_RDB_SWITCH);
    // if (rdbSwitch) {
      const intervalType = service.blockData.INTERVAL_TYPE;
      let type;
      if (interval === 133 || interval === 514) {
        type = intervalType.min; // every min in an hour
      } else if (interval === 3200) {
        type = intervalType.hour; // every hour in a day
      } else {
        type = intervalType.day; // every day in a month or all
      }
      const response = await service.blockData.listStat(type, 0, limit + 1);
      return response.list.slice(0, response.list.length - 1);
    // }

    // const list = await syncSDK.plotStatistic({ limit: limit + 1, interval }); // +1 for diff
    // return this._diff(list);
  }

  async trend({ interval } = {} as any) {
    const [previous = {}, current = {}] = await this.plot({ limit: 2, interval });

    return lodash.mapValues(current, (value, key) => {
      const prev = previous[key];
      const trend = !prev || prev.isZero() ? BigFixed(0) : value.div(prev).sub(1);
      return { value, trend };
    });
  }
}

