import {ScanApp} from "./index";
import {fmtAddr, StatApp} from "../../stat/StatApp";

const lodash = require('lodash');

export class EventLogService {
  app: ScanApp & any;
  constructor(app) {
    this.app = app;
  }

  async queryByTransactionHash({ transactionHash, aggregate }) {
    const {
      app: { service },
    } = this;

    const eventLogArray = await service.conflux.getLogsByTransactionHash(transactionHash);
    const eventLog = lodash.get(eventLogArray, 0);
    if (!eventLog) {
      return { total: 0, list: [] };
    }

    // XXX: eventLog.epochNumber come from `service.conflux.getLogsByTransactionHash`
    const epoch = await service.epoch.query({ epochNumber: eventLog.epochNumber }) || {};
    const result = lodash.forEach(eventLogArray, (event) => lodash.defaults({}, event, {
      timestamp: epoch.timestamp,
      syncTimestamp: epoch.timestamp,
    }));
    result.forEach(item => item.address = fmtAddr(item.address, StatApp.networkId));
    return { total: result.length, list: result, aggregate };
  }

  async query({ transactionHash, transactionLogIndex }) {
    const {
      app: { service },
    } = this;

    const eventLogArray = await service.conflux.getLogsByTransactionHash(transactionHash);
    const eventLog = lodash.get(eventLogArray, transactionLogIndex);
    if (!eventLog) {
      return null;
    }

    // XXX: eventLog.epochNumber come from `service.conflux.getLogsByTransactionHash`
    const epoch = await service.epoch.query({ epochNumber: eventLog.epochNumber }) || {};
    return lodash.defaults({}, eventLog, {
      timestamp: epoch.timestamp,
      syncTimestamp: epoch.timestamp,
    });
  }
}

