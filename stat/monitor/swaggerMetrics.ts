import {loadConfig, StatConfig} from "../config/StatConfig";
import {FieldType, InfluxDB} from "influx";
import {safeAddErrorLog} from "./ErrorMonitor";

const superagent = require('superagent');

export async function fetchSwaggerMetrics(port: string|number = 8895, path_ = '') {
	const path = path_ || `v1/api-stat`;
	const {body:{name,ip,timeline:{settings:{bucket_current}, data}}} = await superagent.get(`http://127.0.0.1:${port}/${path}/stats?fields=timeline`);
	const {stats:{req_rate},} = data[bucket_current];
	const {sys:{lag}} = data[bucket_current - 1];
	// console.log(`${name} ${ip} qps ${req_rate} lag ${lag}`);
	return {name, ip, qps: req_rate, lag};
}
const defaultMeasurement = 'scan-api';
async function report(measurement: string, inf: InfluxDB, dataPort: number|string, nameFix: string, path: string) {
	const {name, ip, qps, lag} = await fetchSwaggerMetrics(dataPort, path);
	return inf.writePoints([{
		measurement: measurement || defaultMeasurement,
		tags: {name: nameFix ? `${name}_${nameFix}` : name, ip}, fields: {qps, lag}
	}])
}

function setup(influxDB: any) {
	if (!influxDB) {
		return null
	}
	const {host, database, username, password, disable, measurement, port, protocol,} = influxDB;
	if (disable) {
		return null;
	}
	return new InfluxDB({
		host, database, username, password, port, protocol,
		schema: [{
				measurement: measurement || defaultMeasurement,
				fields: {
					qps: FieldType.INTEGER,					lag: FieldType.INTEGER,
					ip: FieldType.STRING, name: FieldType.STRING,
				},
				tags: ['ip', 'name'],
		}]
	});
}

export async function scheduleSwaggerReporter(influxDB: any, dataPort: number|string, name = '', path = '') {
	const inf = setup(influxDB);
	if (!inf) {
		return
	}
	setInterval(async ()=>{
		try {
			await report(influxDB.measurement, inf, dataPort, name, path)
		} catch (e) {
			safeAddErrorLog(`swagger-metrics`, `upload-data`, e).then();
		}
	}, 30_000);
}

async function main() {
	const [,,cmd,arg1] = process.argv;
	// await fetchSwaggerMetrics();
	const cfg = loadConfig('Prod');
	scheduleSwaggerReporter(cfg.influxDB, cfg.v1port || 8895).then();
}

if (module == require.main) {
	main().then()
}
