import {loadConfig, StatConfig} from "../config/StatConfig";
import {FieldType, InfluxDB} from "influx";

const superagent = require('superagent');

export async function fetchSwaggerMetrics(port = 8895) {
	const {body:{name,ip,timeline:{settings:{bucket_current}, data}}} = await superagent.get(`http://127.0.0.1:${port}/v1/api-stat/stats?fields=timeline`);
	const {stats:{req_rate},} = data[bucket_current];
	const {sys:{lag}} = data[bucket_current - 1];
	console.log(`${name} ${ip} qps ${req_rate} lag ${lag}`);
	return {name, ip, qps: req_rate, lag};
}

async function report(config: StatConfig, inf: InfluxDB) {
	const {name, ip, qps, lag} = await fetchSwaggerMetrics(config.v1port);
	return inf.writePoints([{
		tags: {name, ip}, fields: {qps, lag}
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
				measurement: measurement,
				fields: {
					qps: FieldType.INTEGER,					lag: FieldType.INTEGER,
					ip: FieldType.STRING, name: FieldType.STRING,
				},
				tags: ['ip', 'name'],
		}]
	});
}

export async function scheduleSwaggerReporter(config: StatConfig) {
	const inf = setup(config);
	if (!inf) {
		return
	}
	setInterval(()=>report(config, inf), 30_000);
}

async function main() {
	const [,,cmd,arg1] = process.argv;
	// await fetchSwaggerMetrics();
	const cfg = loadConfig('Prod');
	scheduleSwaggerReporter(cfg).then();
}

if (module == require.main) {
	main().then()
}
