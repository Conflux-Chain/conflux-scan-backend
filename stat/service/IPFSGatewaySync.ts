import {KEY_FASTEST_IPFS_GATEWAY, KV} from "../model/KV";

const superagent = require('superagent');
const lodash = require('lodash');
const ping = require('ping');

export class IPFSGatewaySync {
  public static fastest;
  private static GATEWAY_ARRAY = [];
  private static GATEWAY_SET = new Set<string>();
  private static GATEWAY_MAP = {};

  private TIMEOUT_PING = 3; // sec
  private TIMEOUT_RESPONSE = 3; // sec
  private TIMEOUT_DEADLINE = 3; // sec
  private CODE_OK = 'OK';
  private CODE_NOT_OK = 'NOT_OK';
  private URL_GATEWAY = 'https://raw.githubusercontent.com/ipfs/public-gateway-checker/master/src/gateways.json';
  private CID_FOR_SAMPLE = 'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m'; // Hello from IPFS Gateway Checker
  private app;

  constructor(app: any) {
    this.app = app;
  }

  public static tmplFromGateway(userGateway) {
    let target = userGateway;

    if(target.endsWith('/')) {
      target = target.substr(0, target.length - 1);
    }

    target = `${target}/ipfs/:hash`;
    if(!IPFSGatewaySync.GATEWAY_SET.has(target)) {
      return undefined;
    }

    return target;
  }

  public async schedule(delay: number = 1000 * 60) {
    console.log(`schedule detect_gateway sync with delay: ${delay}`);

    const that = this;
    async function repeat() {
      await that.detectGateways().catch(err=>{ console.log(`sync detect_gateway fail: `, err) });
      setTimeout(repeat, delay);
    }

    repeat().then();
  }

  private async detectGateways() {
    await this.fetchGateways();
    const clonedGatewayArray = [...IPFSGatewaySync.GATEWAY_ARRAY];
    const total = clonedGatewayArray.length;

    let curPage = 1;
    let skip = 0;
    let pageSize = 5;
    this.clearGateways();
    do {
      const gatewayArray = clonedGatewayArray.slice(skip, skip + pageSize);
      if (!gatewayArray?.length) break;

      const taskArray = lodash.map(gatewayArray, gateway => this.detect(gateway));
      await Promise.all(taskArray);
      skip = (++curPage - 1) * pageSize;
    } while (skip <= total);

    await this.setFastest();
  }

  private async fetchGateways() {
    if(IPFSGatewaySync.GATEWAY_ARRAY?.length) {
      return;
    }

    const response = await superagent
        .get(this.URL_GATEWAY)
        .timeout({response: this.TIMEOUT_RESPONSE * 1000, deadline: this.TIMEOUT_DEADLINE * 1000})
        .catch(() => undefined);

    if(response?.text) {
      IPFSGatewaySync.GATEWAY_ARRAY = JSON.parse(response.text);
      IPFSGatewaySync.GATEWAY_SET = new Set<string>(IPFSGatewaySync.GATEWAY_ARRAY);
    }
  }

  private async detect(gateway){
    const host = IPFSGatewaySync.hostFromUrl(gateway);
    const url = gateway.replace(':hash', this.CID_FOR_SAMPLE);
    const result = {data:{gateway, host, url}} as any;

    const pingResult = await this.ping(host);
    if(pingResult.code !== this.CODE_OK) {
      return lodash.assign(result,  {code: this.CODE_NOT_OK, message: 'ping fail'});
    }

    const curlResult =  await this.curl(url);
    if(curlResult.code !== this.CODE_OK) {
      return lodash.assign(result,  {code: this.CODE_NOT_OK, message: 'curl fail'});
    }

    lodash.assign(result.data, {time: pingResult.data.time})
    lodash.assign(result, {code: this.CODE_OK, message: 'success'})
    IPFSGatewaySync.GATEWAY_MAP[gateway] = result;
    return result;
  }

  private async ping(host){
    let pong = await ping.promise.probe(host, {
      timeout: this.TIMEOUT_PING,
    });

    const result = {data: {host, time: pong?.time}};
    if(!pong || !pong.alive || pong.time > 1000) {
      return lodash.assign(result, {code: this.CODE_NOT_OK, message: 'ping fail'});
    }

    return lodash.assign(result, {code: this.CODE_OK, message: 'ping success'});
  }

  private async curl(url){

    const start = Date.now();
    const response = await superagent.get(url)
        .timeout({response: this.TIMEOUT_RESPONSE * 1000, deadline: this.TIMEOUT_DEADLINE * 1000})
        .catch(() => undefined);

    const result = {data: {url, time: Date.now() - start}};
    if(response?.status === 200 && response?.header['content-length']
        && response?.header['content-type']?.startsWith('text/plain')){
      return lodash.assign(result, {code: this.CODE_OK, message: 'curl success'});
    }

    return lodash.assign(result, {code: this.CODE_NOT_OK, message: 'curl fail'});
  }

  private static hostFromUrl(url) {
    const parts = url.split("://");
    const urlExcludeProtocol = parts?.length > 1 ? parts[1] : parts[0];

    const segments = urlExcludeProtocol.split("/");
    const urlExcludePath = segments[0];
    const host = urlExcludePath;

    return host;
  }

  private clearGateways() {
    IPFSGatewaySync.GATEWAY_MAP = {};
  }

  private async setFastest() {
    let dataArray = Object.values(IPFSGatewaySync.GATEWAY_MAP).map((result:any) => result.data);
    dataArray = lodash.orderBy(dataArray, 'time', 'asc');
    const data = dataArray.shift();
    const fastest = data?.gateway;

    if(!fastest) {
      console.log(`no ipfs gateway available!`);
      return;
    }

    await KV.upsert({key: KEY_FASTEST_IPFS_GATEWAY, value: fastest});
    IPFSGatewaySync.fastest = fastest;
    console.log(`fastest ipfs gateway ${fastest}`);
  }
}
