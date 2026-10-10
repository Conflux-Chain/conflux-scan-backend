import * as KoaRouter from "koa-router";
import {supplyDeductionDrip, HomepageDashboard} from "../../stat/service/HomepageDashboard";
const {router_get} = require("../../koaflow/src/koaHelper");
const {Drip} = require('js-conflux-sdk');
const {formatDecimal} = require('../../stat/service/common/utils');

const router = new KoaRouter();

router_get(router, '/circulating',

	// eslint-disable-next-line prefer-arrow-callback
	async function () {
		const supplyInfo = HomepageDashboard.getData()?.supplyInfo as any || {totalCirculating: 0};
		const {totalCirculating} = supplyInfo;

		// Falsy covers the first seconds after boot and, now, a release schedule that
		// could not be resolved -- see scheduleMessage. Answer nothing rather than a
		// number that is wrong by the whole locked allocation.
		if (!totalCirculating) {
			return "";
		}

		return formatDecimal(Drip(`${BigInt(totalCirculating) - supplyDeductionDrip(supplyInfo)}`).toCFX(), 2);
	},
);

router_get(router, '/total',
	// eslint-disable-next-line prefer-arrow-callback
	async function () {
		const data = HomepageDashboard.getData()?.supplyInfo || {totalIssued: 0};
		// @ts-ignore
		const {totalIssued} = data;
		if (totalIssued == 0) {
			return ""
		}
		return formatDecimal(Drip(`${BigInt(totalIssued) - supplyDeductionDrip(data)}`).toCFX(), 2);
	},
);

module.exports = router;
