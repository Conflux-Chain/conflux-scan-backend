import * as KoaRouter from "koa-router";
import {HomepageDashboard} from "../../stat/service/HomepageDashboard";
const {router_get} = require("../../koaflow/src/koaHelper");
const {Drip} = require('js-conflux-sdk');
const {formatDecimal} = require('../../stat/service/common/utils');

const router = new KoaRouter();

router_get(router, '/circulating',

	// eslint-disable-next-line prefer-arrow-callback
	async function () {
		const {
			totalCirculating,
			nullAddressBalance,
		} = HomepageDashboard.getData()?.supplyInfo as any || {totalCirculating: 0, nullAddressBalance: 0,};

		if (totalCirculating == 0) {
			return "";
		}

		return formatDecimal(Drip(`${BigInt(totalCirculating) - BigInt(nullAddressBalance)}`).toCFX(), 2);
	},
);

router_get(router, '/total',
	// eslint-disable-next-line prefer-arrow-callback
	async function () {
		const data = HomepageDashboard.getData()?.supplyInfo || {totalIssued: 0, nullAddressBalance: 0};
		// @ts-ignore
		const {totalIssued, nullAddressBalance} = data;
		if (totalIssued == 0) {
			return ""
		}
		return formatDecimal(Drip(`${BigInt(totalIssued) - BigInt(nullAddressBalance)}`).toCFX(), 2);
	},
);

module.exports = router;
