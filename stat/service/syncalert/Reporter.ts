import {FieldType, InfluxDB} from 'influx'
import {
    BlockTxSampler,
    CfxTransferSampler,
    EpochMiscSampler,
    PosBlockSampler,
    Sampler,
    TokenTransferSampler
} from "./Sampler";

const lodash = require('lodash');

export class Reporter{

    private readonly app: any;
    private readonly measurement: string;
    private influx: InfluxDB;
    private samplerArray: Sampler[];

    public constructor(app: any) {
        this.app = app;
        this.measurement = 'scan_sync_monitor';
        this.initInflux();
        this.registerSampler();
    }

    private initInflux() {
        const {
            app:{ config }
        } = this;

        const {host, database, username, password} = config.influxDB;
        this.influx = new InfluxDB({
            host, database, username, password,
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

    private registerSampler(){
        this.samplerArray = [
            new BlockTxSampler(this.app),
            new CfxTransferSampler(this.app),
            new TokenTransferSampler(this.app),
            new EpochMiscSampler(this.app),
            new PosBlockSampler(this.app),
        ];
    }

    private async report(pointArray: any[]) {
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
        const tasks = lodash.map(this.samplerArray, sampler => sampler.sample());
        const pointArray = await Promise.all(tasks);
        pointArray.forEach(point => lodash.defaults(point, {measurement: this.measurement}));
        // console.log(`[alert]scanSyncMonitor report pointArray:${JSON.stringify(pointArray)}`);
        await this.report(pointArray);
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
