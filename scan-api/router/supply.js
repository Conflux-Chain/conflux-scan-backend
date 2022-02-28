const Koaflow = require('koaflow');
const { Drip } = require('js-conflux-sdk');
const jsonrpc = require('./jsonrpc');

const router = new Koaflow.Router();

router.get('/circulating',
  jsonrpc.methodFlow('supply'),

  // eslint-disable-next-line prefer-arrow-callback
  async function ({ totalCirculating }) {
    return Drip(totalCirculating).toCFX();
  },
);

module.exports = router;
