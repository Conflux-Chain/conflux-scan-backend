import {ScanApp, ScanCtx} from "./index";

const lodash = require('lodash');

export class EpochService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
  }

  async query({ epochNumber } = {} as any) {
    const {
      app: { ttlMap, service },
    } = this as ScanCtx;

    if (!Number.isInteger(epochNumber)) {
      return null;
    }

    return ttlMap.cache(`EpochService.query(${epochNumber})`,
      async () => {
        let epoch;
          epoch = await service.epochRdb.query(epochNumber);
          if (epoch) {
            epoch.timestamp = epoch.timestamp.getTime() / 1000;
          }

        return epoch || service.conflux.getEpochByEpochNumber(epochNumber);
      },
      { ttl: (epoch) => (lodash.isEmpty(epoch) ? 1000 : 5 * 1000) },
    );
  }
}

