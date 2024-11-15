import {loadConfig, StatConfig} from "../config/StatConfig";
import {FieldType, InfluxDB} from "influx";

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
async function report(config: StatConfig, inf: InfluxDB, dataPort: number|string, nameFix: string, path: string) {
	const {name, ip, qps, lag} = await fetchSwaggerMetrics(dataPort, path);
	return inf.writePoints([{
		measurement: config.influxDB.measurement || defaultMeasurement,
		tags: {name: nameFix ? `${name}_${nameFix}` : name, ip}, fields: {qps, lag}
	}])
}

function setup(config: StatConfig) {
	const {host, database, username, password, disable, measurement, port, protocol,} = config.influxDB;
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

export async function scheduleSwaggerReporter(config: StatConfig, dataPort: number|string, name = '', path = '') {
	const inf = setup(config);
	if (!inf) {
		return
	}
	setInterval(()=>report(config, inf, dataPort, name, path), 30_000);
}

async function main() {
	const [,,cmd,arg1] = process.argv;
	// await fetchSwaggerMetrics();
	const cfg = loadConfig('Prod');
	scheduleSwaggerReporter(cfg, cfg.v1port || 8895).then();
}

if (module == require.main) {
	main().then()
}
