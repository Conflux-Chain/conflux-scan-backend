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

    // The query returns raw DECIMAL values as strings (raw: true) plus non-metric
    // metadata fields (statTime, timestamp) that are not BigFixed. Only compute the
    // trend over the real metric keys and coerce each value to BigFixed, otherwise
    // `prev.isZero()`/`value.div()` throw ("prev.isZero is not a function").
    const toBF = (v: any) => (v == null ? BigFixed(0) : BigFixed(String(v)));
    const metrics = ['tps', 'difficulty', 'blockTime', 'hashRate'];

    const out: any = {};
    for (const key of metrics) {
      const v = toBF(current[key]);
      const p = toBF(previous[key]);
      out[key] = { value: v, trend: p.isZero() ? BigFixed(0) : v.div(p).sub(1) };
    }
    return out;
  }
}
