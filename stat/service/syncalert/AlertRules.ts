import { Meter, MetricRegistry } from "inspector-metrics";
import {IMetric, SamplerType} from "./Sampler";
import {ConfigInstance} from "../../config/StatConfig";
import {dingMsg} from "../../monitor/Monitor";
import * as fs from "fs";
import {sendAlertTg} from "../../monitor/telegram";

const registry = new MetricRegistry();
let lastAlertTime = 0;

interface IMeterData {
	meterGap: Meter,
	meterGrowth: Meter,
	lastV: number, name: string,
	counter: number,
}
const map:Map<string, IMeterData> = new Map<string, IMeterData>();

export function pushMeter(metrics: IMetric[]) {
	const testAlertFlagFile = __filename + ".test";
	const doTest = fs.existsSync(testAlertFlagFile);
	let cnt = 0;
	const alertMsgArr = [];
	for(const m of metrics) {
		const {tags:{syncType}, fields: {latestSynced, syncGap}} = m;
		const meterData = map.get(m.tags.syncType);
		if (!meterData) {
			map.set(syncType, {
				meterGap: registry.newMeter(syncType+"_gap"),
				meterGrowth: registry.newMeter(syncType+"_growth"),
				lastV: latestSynced,
				name: syncType, counter: 0,
			});
			continue
		}
		meterData.counter ++;
		cnt = meterData.counter;
		meterData.meterGap.mark(syncGap);
		meterData.meterGrowth.mark(Math.max(latestSynced - meterData.lastV, 0));
		meterData.lastV = latestSynced;
		//
		[meterData.meterGap, meterData.meterGrowth].forEach(m=>{
			console.log(`meter info : ${m.getName().padEnd(20, ' ')} 1m ${m.get1MinuteRate() * 60} 5m ${m.get5MinuteRate() * 60
			}, 15m ${m.get15MinuteRate() * 60}`)
		})
		if (doTest && meterData.counter > 0){
			// do test with at least one round data.
		} else	if (meterData.counter < 5) {
			continue;
		}

		{//var scope block
			// height doesn't grow.
			const thresholdOfGrowth = ConfigInstance.noCoreSpace ? 1 : 50;
			const v5mGrowth = meterData.meterGrowth.get5MinuteRate() * 60 * 5; // the returned value is based on 1 second.
			// pos block is generated every minute.
			const growthThreshold = meterData.name == SamplerType.POS_BLOCK ? 1 : thresholdOfGrowth;
			if (v5mGrowth < growthThreshold || doTest) {
				const msg = `height doesn't grow, ${meterData.name}, in last 5 minutes, total growth is ${
					v5mGrowth.toFixed(2)} < ${growthThreshold}`;
				console.log(msg);
				alertMsgArr.push(msg);
			}
		}
		// gap is too large.
		const thresholdOfGap = ConfigInstance.noCoreSpace ? 100 : 200;
		const v5mGap_per_1m = meterData.meterGap.get5MinuteRate() * 60;
		if (v5mGap_per_1m > thresholdOfGap || doTest) {
			const msg = `gap is too large, ${meterData.name}, in last 5 minutes, gap per minute is ${
				v5mGap_per_1m.toFixed(2)} > ${thresholdOfGap}`;
			console.log(msg);
			alertMsgArr.push(msg);
		}
	}
	const alertTimeAllow = Date.now() - lastAlertTime > 1000 * 3600 * 4;
	console.log(`${__filename} ok , round ${cnt} , alert msg count ${alertMsgArr.length} ,  alertTimeAllow ${alertTimeAllow}`);
	if (alertMsgArr.length && alertTimeAllow) {
		const msg = alertMsgArr.join('\n');
		if (ConfigInstance.tgToken) {
			sendAlertTg(doTest ? "--TEST ALERT--" + msg : msg).then();
		} else {
			dingMsg(doTest ? "--TEST ALERT--" + msg : msg, ConfigInstance.dingTalkToken).then();
		}
		if (doTest) {
			fs.rm(testAlertFlagFile, ()=>{});
		} else {
			lastAlertTime = Date.now();
		}
	}
}

