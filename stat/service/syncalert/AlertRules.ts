import { Meter, MetricRegistry } from "inspector-metrics";
import {IMetric} from "./Sampler";

const registry = new MetricRegistry();

interface IMeterData {
	meterGap: Meter,
	meterGrowth: Meter,
	lastV: number, name: string,
	counter: number,
}
const map:Map<string, IMeterData> = new Map<string, IMeterData>();

export function pushMeter(metrics: IMetric[]) {
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
		meterData.meterGap.mark(syncGap);
		meterData.meterGrowth.mark(Math.max(latestSynced - meterData.lastV, 0));
		//
		[meterData.meterGap, meterData.meterGrowth].forEach(m=>{
			console.log(`meter info : ${m.getName().padEnd(20, ' ')} 1m ${m.get1MinuteRate() * 60} 5m ${m.get5MinuteRate() * 60 * 5
			}, 15m ${m.get15MinuteRate() * 60 * 15} , count ${m.getCount()}`)
		})
		if (meterData.counter < 5) {
			continue;
		}

		// gap is too large, or, height doesn't grow.
		const v5mGrowth = meterData.meterGrowth.get5MinuteRate() * 60 * 5; // the returned value is based on 1 second.
		const threshold = 100;
		if (v5mGrowth < threshold) {
			console.log(`height doesn't grow, ${meterData.name}, 5minutes, v ${v5mGrowth} < ${threshold}`);
		}
		const v5mGap = meterData.meterGap.get5MinuteRate() * 60 * 5;
		if (v5mGap > threshold) {
			console.log(`gap is too large, ${meterData.name}, 5minutes, v ${v5mGrowth} > ${threshold}`);
		}
	}
}
