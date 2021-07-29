const HttpProvider = require("js-conflux-sdk/src/provider/HttpProvider")
const superagent = require('superagent');
const pLimit = require('p-limit');
const limit = pLimit(1);
export class ScanHttpProvider extends HttpProvider {
    tag: string
    times = 0
    methodTimes = {}
    constructor(conf, tag) {
        super(conf);
        // this.headers = {Connection: "keep-alive"}
        this.tag = tag
    }
    async request(data) {
        return limit(()=>this.request0(data))
    }
    async request0(data) {
        this.times ++
        this.methodTimes[data.method] = (this.methodTimes[data.method] || 0) + 1
        console.log(` ----- ${this.tag}, total times ${this.times}: request rpc ${data.method
        } x ${this.methodTimes[data.method]}, header `, this.headers)
        const { body } = await superagent
            .post(this.url)
            .retry(this.retry)
            .set(this.headers)
            .send(data)
            .timeout(this.timeout);

        return body || {};
    }
}