import {Conflux} from "js-conflux-sdk";
const abi = require('./abi');
const lodash = require('lodash');

export class TokenTool {
    protected cfx;
    protected contract;
    constructor(cfx:Conflux) {
        this.cfx = cfx;
        this.contract = cfx.Contract({abi});
    }

    async getToken(address, epochNumber = undefined): Promise<any> {
        return this.awaitObject({
            address,
            name: this.contract.name()
                .call({to: address}, epochNumber)
                .catch(() => undefined),
            symbol: this.contract.symbol()
                .call({to: address}, epochNumber)
                .catch(() => undefined),
            decimals: this.contract.decimals()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch(() => undefined),
            granularity: this.contract.granularity()
                .call({to: address}, epochNumber)
                .then(Number)
                .catch(() => undefined),
        });
    }

    async getTokenTotalSupply(address, epochNumber = undefined) {
        return this.contract.totalSupply()
            .call({to: address}, epochNumber)
            .then(BigInt)
            .catch(() => undefined);
    }

    async awaitObject(object): Promise<any> {
        const result = {};
        await Promise.all(lodash.map(object, async (promise, key) => {
            result[key] = await promise;
        }));
        return result;
    }
}