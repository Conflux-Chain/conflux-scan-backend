const {Router} = require('../../koaflow/src/router');
const { Drip } = require('js-conflux-sdk');
const {jsonrpc} = require('./jsonrpc');
const { formatDecimal } = require('../../stat/service/common/utils');

const router = new Router();

router.get('/circulating',
  jsonrpc.methodFlow('supply'),

  // eslint-disable-next-line prefer-arrow-callback
  async function ({ totalCirculating }) {
    return formatDecimal(Drip(totalCirculating).toCFX(), 2);
  },
);

router.get('/total',
    jsonrpc.methodFlow('supply'),

    // eslint-disable-next-line prefer-arrow-callback
    async function ({ totalIssued, nullAddressBalance }) {
        return formatDecimal(Drip(`${BigInt(totalIssued) - BigInt(nullAddressBalance)}`).toCFX(), 2);
    },
);

module.exports = router;
