import {MetricRegistry, MILLISECOND} from "inspector-metrics";
import {DefaultSender, InfluxMetricReporter} from "inspector-influx";
import {StatApp} from "../../stat/StatApp";

const CONST = require('../../stat/service/common/constant');
const { cfxUrls, ethUrls } = require('./ApiUrl');

export class Metrics {
    private readonly config: any;
    private readonly metricsEnv: string;
    private metricMapping = new Map();
    private reporter: InfluxMetricReporter;
    private registry: MetricRegistry;

    /**
     * constructor
     *
     * @param bizName
     *      ether open or scan
     * @param config
     *      system config
     */
    constructor(config: any) {
        this.config = config;
        this.metricsEnv = config.metricsEnv;
    }

    public async init(){
        let tags;
        if(this.metricsEnv){
            tags = new Map<string, string>();
            tags.set('env', this.metricsEnv);
        }

        await this.initReport();

        const urls = StatApp.isEVM ? ethUrls : cfxUrls;
        for(const url of Object.values(urls.paths)){
            if(url !== ethUrls.paths.gateway) {
                this.initTimer({prefix: urls.prefix, url, tags});
                continue;
            }

            Object.values(CONST.E_SPACE_OPENAPI).forEach(item => {
                const module = item['module'];
                Object.values(item['action']).forEach(
                    action => {
                        this.initTimer({prefix: urls.prefix, url, module, action, tags});
                    }
                );
            });
        }
    }

    public async metric({ctx, elapsed}) {
        const requestUrl = ctx.url;
        const url = requestUrl.indexOf('?') > -1 ? requestUrl.substr(0, requestUrl.indexOf('?')) : requestUrl;

        const requestData = Object.keys(ctx.request.query).length ? ctx.request.query : ctx.request.body;
        const {module, action} = requestData;

        const name = this.getMeasurement({url, module, action});
        const timer = this.metricMapping.get(name);

        timer?.addDuration(elapsed, MILLISECOND);
    }

    private async initReport(){
        const {host, database, username, password} = this.config.influxDB
        const dbConfig = {username, password, database, hosts: [{ host, port: 8086 }]};

        this.reporter = new InfluxMetricReporter({
            log: global.console,
            sender: new DefaultSender(dbConfig, 'ms'),
            reportInterval: 10000,
        });
        this.registry = new MetricRegistry();
        this.reporter.addMetricRegistry(this.registry);

        await this.reporter.start();
    }

    private initTimer({prefix = undefined, url = undefined, module = undefined, action = undefined, tags = undefined}) {
        const name = this.getMeasurement({prefix, url, module, action});

        const timer = this.registry.newTimer(name);
        tags?.forEach((value, tag) =>  timer.setTag(tag, value));

        this.metricMapping.set(name, timer);
    }

    private getMeasurement({prefix = undefined, url = undefined, module = undefined, action = undefined}) {
        let path;
        if(module && action){
            path = `${!prefix ? '' : prefix}${url}/${module}/${action}`
        } else{
            path = `${!prefix ? '' : prefix}${url}`;
        }

        const subPaths = path.split('/').filter(Boolean);
        let suffix = subPaths.slice(1, subPaths.length)
            .map(item => `${item.slice(0,1).toUpperCase()}${item.slice(1)}`).join('');

        return `${subPaths[0]}_${suffix}`;
    }
}
