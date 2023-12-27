const Koaflow = require('koaflow');
const { Drip } = require('js-conflux-sdk');
const jsonrpc = require('./jsonrpc');
const { formatDecimal } = require('../../stat/dist/service/common/utils');

const router = new Koaflow.Router();

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
