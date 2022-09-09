import {IPFSGatewayArray} from "../config/IPFSGateway";
import {KEY_FASTEST_IPFS_GATEWAY, KV} from "../model/KV";

const superagent = require('superagent');
const lodash = require('lodash');
const ping = require('ping');

export class IPFSGatewaySync {
  private app;
  private readonly total;
  private SAMPLE_URL = `https://__host__/ipfs/bafybeica42myebp6hqfto27pd4qjuzgrfinozeg47gssoag5iz5iw2ymoe/metadata.json`;
  private TIMEOUT = 3;
  private CODE_OK = 'OK';
  private CODE_NOTOK = 'NOTOK';
  private static GATEWAY_MAP = {};

  public static fastest;

  constructor(app: any) {
    this.app = app;
    this.total = IPFSGatewayArray.length;
    lodash.forEach(IPFSGatewayArray, url => IPFSGatewaySync.GATEWAY_MAP[url] = {});
  }

  public async schedule(delay: number = 1000 * 60) {
    console.log(`schedule detect_gateway sync with delay: ${delay}`);

    const that = this;
    async function repeat() {
      await that.detectGateway().catch(err=>{ console.log(`sync detect_gateway fail: `, err) });
      setTimeout(repeat, delay);
    }

    repeat().then();
  }

  private async detectGateway() {
    let curPage = 1;
    let skip = 0;
    let pageSize = 5;
    do {
      const gatewayArray = IPFSGatewayArray.slice(skip, skip + pageSize);
      if (!gatewayArray?.length) break;

      const tasks = lodash.map(gatewayArray, host => this.detect(host));
      const responseArray: any[] = await Promise.all(tasks);

      for(const response of responseArray) {
        if(!response) continue;
        console.log(`detect_ipfs_gateway------${JSON.stringify(response)}`);
        const {pong: {host, alive, time}} = response;
        if(alive && time <= 1000) {
          IPFSGatewaySync.GATEWAY_MAP[host] = response;
        } else {
          IPFSGatewaySync.GATEWAY_MAP[host] = undefined;
        }
      }

      skip = (++curPage - 1) * pageSize;
    } while (skip <= this.total);

    await this.setFastest();
  }

  private async detect(host){
    const pong = await this.ping(host);
    if(!pong?.alive || pong.time > 1000) {
      // console.log(`host:${host}------pong:${JSON.stringify(pong)}`)
      return;
    }

    const response =  await this.curl(host);
    if(response.result !== this.CODE_OK) {
      // console.log(`host:${host}------curl:${JSON.stringify(response)}`)
      return;
    }

    return {
      pong,
      response,
    };
  }

  private async ping(host){
    const pong = await ping.promise.probe(host, {
      timeout: this.TIMEOUT,
    });

    return lodash.pick(pong, ['host', 'alive', 'time']);
  }

  private async curl(host){
    const url = this.SAMPLE_URL.replace('__host__', host);
    const start = Date.now();
    const response = await superagent.get(url)
        .timeout({response: this.TIMEOUT * 1000, deadline: this.TIMEOUT * 1000})
        .catch(() => undefined);

    if(response?.status === 200 && response?.header['content-length']
        && response?.header['content-type'] === 'application/json'){
      return {
        host,
        url,
        result: this.CODE_OK,
        time: Date.now() - start,
      }
    }

    return {result: this.CODE_NOTOK};
  }

  private async setFastest() {
    let responseArray = Object.values(IPFSGatewaySync.GATEWAY_MAP).map((detectInfo:any) => detectInfo.response);
    responseArray = lodash.orderBy(responseArray, 'time', 'asc');
    const gateway = responseArray.shift();
    const fastest = gateway?.host;

    await KV.upsert({key: KEY_FASTEST_IPFS_GATEWAY, value: fastest});
    IPFSGatewaySync.fastest = fastest;
  }
}
