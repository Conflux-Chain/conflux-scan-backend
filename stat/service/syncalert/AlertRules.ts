import { Meter, MetricRegistry } from "inspector-metrics";
import {IMetric, SamplerType} from "./Sampler";

const registry = new MetricRegistry();

interface IMeterData {
	meterGap: Meter,
	meterGrowth: Meter,
	lastV: number, name: string,
	counter: number,
}
const map:Map<string, IMeterData> = new Map<string, IMeterData>();

export function pushMeter(metrics: IMetric[]) {
	let cnt = 0;
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
		if (meterData.counter < 5) {
			continue;
		}

		// gap is too large, or, height doesn't grow.
		const threshold = 100;
		{//var scope block
			const v5mGrowth = meterData.meterGrowth.get5MinuteRate() * 60 * 5; // the returned value is based on 1 second.
			// pos block is generated every minute.
			const growthThreshold = meterData.name == SamplerType.POS_BLOCK ? 1 : threshold;
			if (v5mGrowth < growthThreshold) {
				console.log(`height doesn't grow, ${meterData.name}, in last 5 minutes, total growth is ${v5mGrowth} < ${growthThreshold}`);
			}
		}
		const v5mGap_per_1m = meterData.meterGap.get5MinuteRate() * 60;
		if (v5mGap_per_1m > threshold) {
			console.log(`gap is too large, ${meterData.name}, in last 5 minutes, gap per minute is ${v5mGap_per_1m} > ${threshold}`);
		}
	}
	console.log(`${__filename} ok , round ${cnt}`)
}
