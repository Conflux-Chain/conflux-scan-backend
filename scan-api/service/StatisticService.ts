import {ScanApp, ScanCtx} from "./index";
import {CONST} from "../../stat/service/common/constant";
import {INTERVAL_TYPE} from "../../stat/service/common/utils";

const lodash = require('lodash');
const BigFixed = require('bigfixed');

export class StatisticService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
  }

  async dag({ limit = 10 } = {}) {
    const {
      app: { service },
    } = this as ScanCtx;

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

  async plot({interval, limit} = {} as any) {
    const {
      app: {service},
    } = this as ScanCtx;

    let intervalType;
    if (interval === 133 || interval === 514) {
      intervalType = INTERVAL_TYPE.min; // every min in an hour
    } else if (interval === 3200) {
      intervalType = INTERVAL_TYPE.hour; // every hour in a day
    } else {
      intervalType = INTERVAL_TYPE.day; // every day in a month or all
    }

    return service.statsQuery.listLatestBlockDataStats({intervalType, limit});
  }

  async trend({ interval } = {} as any) {
    const {list: [previous = {}, current = {}]} = await this.plot({limit: 2, interval});

    /*
     * `!prev` only guarded against a missing row. Every row also carries
     * `statTime` and `timestamp` beside the BigFixed columns -- a Date and a
     * String -- and both are truthy, so `prev.isZero()` threw
     * `prev.isZero is not a function` and the whole endpoint answered 500.
     *
     * Guard on the method rather than on a list of known keys, so a column
     * added to the stat rows later cannot bring the TypeError back.
     */
    const comparable = (v) => v && typeof v.isZero === 'function' && typeof v.div === 'function';

    return lodash.mapValues(current, (value, key) => {
      const prev = previous[key];
      const trend = !comparable(value) || !comparable(prev) || prev.isZero()
        ? BigFixed(0) : value.div(prev).sub(1);
      return { value, trend };
    });
  }
}

