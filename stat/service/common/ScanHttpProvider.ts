const HttpProvider = require("js-conflux-sdk/src/provider/HttpProvider")
const superagent = require('superagent');
export class ScanHttpProvider extends HttpProvider {
    tag: string
    times = 0
    methodTimes = {}
    constructor(conf, tag) {
        super(conf);
        this.tag = tag
    }
    async request(data) {
        this.times ++
        this.methodTimes[data.method] = (this.methodTimes[data.method] || 0) + 1
        console.log(` ----- ${this.tag}, total times ${this.times}: request rpc ${data.method
        } x ${this.methodTimes[data.method]}`)
        const { body } = await superagent
            .post(this.url)
            .retry(this.retry)
            .set(this.headers)
            .send(data)
            .timeout(this.timeout);

        return body || {};
    }
}