import {ScanCtx} from "../service/index";

const {Router} = require('../../koaflow/src/router');
const {Drip} = require('js-conflux-sdk');
const {formatDecimal} = require('../../stat/service/common/utils');

const router = new Router();

router.get('/circulating',

	// eslint-disable-next-line prefer-arrow-callback
	async function () {
		const {app: {service},} = this as ScanCtx;
		const data = service.homeDashboard.getData();
		// @ts-ignore
		const totalCirculating = data?.supplyInfo?.totalCirculating ?? 0
		if (totalCirculating == 0) {
			return ""
		}
		return formatDecimal(Drip(totalCirculating).toCFX(), 2);
	},
);

router.get('/total',
	// eslint-disable-next-line prefer-arrow-callback
	async function () {
		const {app: {service},} = this as ScanCtx;
		const data = service.homeDashboard.getData()?.supplyInfo || {totalIssued: 0, nullAddressBalance: 0};
		// @ts-ignore
		const {totalIssued, nullAddressBalance} = data;
		if (totalIssued == 0) {
			return ""
		}
		return formatDecimal(Drip(`${BigInt(totalIssued) - BigInt(nullAddressBalance)}`).toCFX(), 2);
	},
);

module.exports = router;
