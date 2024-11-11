import {FieldType, InfluxDB} from 'influx'
import {
    BlockTxSampler,
    CfxTransferSampler,
    EpochMiscSampler,
    PosBlockSampler, RpcSampler,
    Sampler,
    TokenTransferSampler
} from "./Sampler";
import {StatApp} from "../../StatApp";
import {pushMeter} from "./AlertRules";

const lodash = require('lodash');

export class Reporter{

    private readonly app: any;
    private measurement: string;
    private influx: InfluxDB;
    private samplerArray: Sampler[];

    public constructor(app: any) {
        this.app = app;
        this.initInflux();
        this.registerSampler();
    }

    private initInflux() {
        const {
            app:{ config }
        } = this;

        const {host, database, username, password, disable, measurement, port, protocol,} = config.influxDB;
        if (disable) {
            console.log(`influx is disabled`)
            return;
        }
        this.measurement = measurement || 'scan_sync_monitor';
        this.influx = new InfluxDB({
            host, database, username, password, port, protocol,
            schema: [
                {
                    measurement: this.measurement,
                    fields: {
                        latestSynced: FieldType.INTEGER,
                        latestReached: FieldType.INTEGER,
                        syncGap: FieldType.INTEGER,
                    },
                    tags: [
                        'syncType'
                    ]
                }
            ]
        });
    }

    private registerSampler() {
        const {
            app:{ config }
        } = this;

        this.samplerArray = [
            new BlockTxSampler(this.app),
            new TokenTransferSampler(this.app),
            new EpochMiscSampler(this.app),
            new RpcSampler(this.app),
        ];

        if(!config.conflux.consortiumMode && !config.traceNotAvailable) {
            this.samplerArray.push(new CfxTransferSampler(this.app));
        }

        if(!StatApp.isEVM && !config.conflux.consortiumMode) {
            this.samplerArray.push(new PosBlockSampler(this.app));
        }
    }

    private async report(pointArray: any[]) {
        if (!this.influx) {
            return ;
        }
        return this.influx.writePoints(pointArray).catch(e => {
            console.log(`[alert]scanSyncMonitor report:${JSON.stringify(pointArray)}`, e);
            throw e;
        });
    }

    private async query(measurement: string, conditions: string) {
        const sql = `select * from ${measurement} where ${conditions}`;
        return this.influx.query(sql);
    }

    public async test() {
        const testPoint = {
            measurement: 'test-measurement',
            fields: {
                latestSynced: 1,
                latestReached: 1,
                syncGap: 0,
            },
            tags: {
                syncType: 'test-tag',
            }
        };
        const result = await this.report([testPoint]);
        console.log(`[alert]scanSyncMonitor test write:${JSON.stringify(result)}`);
        const result1 = await this.query(testPoint.measurement, '1=1');
        console.log(`[alert]scanSyncMonitor test query:${JSON.stringify(result1)}`);
    }

    private async sampleSyncProgress(){
        const pointArray = await Promise.all(this.samplerArray.map(s=>s.sample()));
        pointArray.forEach(point => lodash.defaults(point, {measurement: this.measurement}));
        // console.log(`[alert]scanSyncMonitor report pointArray:${JSON.stringify(pointArray)}`);
        await this.report(pointArray);
        pushMeter(pointArray);
    }

    public async start(delay: number = 1000 * 60) {
        const that = this;
        async function repeat() {
            await that.sampleSyncProgress().catch(e=>{
                console.log(`[alert]scanSyncMonitor fail`, e);
            });
            setTimeout(repeat, delay);
        }

        repeat().then();
        console.log(`[alert]scanSyncMonitor report with delay: ${delay}`);
    }
}
