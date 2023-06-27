const { Drip } = require('js-conflux-sdk');
const Koaflow = require('koaflow');
const parameter = require('koaflow/lib/parameter');
const cacheFlow = require('../../common/middleware/cacheFlow');

// ----------------------------------------------------------------------------
const router = new Koaflow.Router();

/**
 * GET /metrics
 */
router.get('/',
  parameter(), // empty parameter for cache

  cacheFlow(15 * 1000),
  async function () {
    const {
      app: { CONST, cfx, prometheus/* , type */, service/* , model */ },
    } = this;

    const epochNumber = await service.conflux.getEpochNumber(CONST.EPOCH_NUMBER.LATEST_MINED);
    prometheus.setGauge('conflux', epochNumber);

    const balance = await cfx.getBalance(service.announce.announcer);
    prometheus.setGauge('announcerBalance', Number(Drip(balance).toCFX()));

    return prometheus.toString();
  },
);

module.exports = router;
