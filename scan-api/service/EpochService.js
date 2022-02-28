const lodash = require('lodash');
const { KV, KEY_EPOCH_QUERY_RDB_SWITCH } = require('../../stat/dist/model/KV');

class EpochService {
  constructor(app) {
    this.app = app;
  }

  async query({ epochNumber } = {}) {
    const {
      app: { syncSDK, ttlMap, service },
    } = this;

    if (!Number.isInteger(epochNumber)) {
      return null;
    }

    return ttlMap.cache(`EpochService.query(${epochNumber})`,
      async () => {
        let epoch;
        const rdbSwitch = await KV.getSwitch(KEY_EPOCH_QUERY_RDB_SWITCH);
        if (rdbSwitch) {
          epoch = await service.epochRdb.query(epochNumber);
          if (epoch) {
            epoch.timestamp = epoch.timestamp.getTime() / 1000;
          }
        } else {
          epoch = await syncSDK.queryEpoch({ epochNumber });
        }

        return epoch || service.conflux.getEpochByEpochNumber(epochNumber);
      },
      { ttl: (epoch) => (lodash.isEmpty(epoch) ? 1000 : 5 * 1000) },
    );
  }
}

module.exports = EpochService;
