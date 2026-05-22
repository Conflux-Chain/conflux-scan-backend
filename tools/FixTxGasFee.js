"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const FullBlock_1 = require("../stat/model/FullBlock");
const sequelize_1 = require("sequelize");
const ProcessTool_1 = require("../stat/service/tool/ProcessTool");
const FixDailyTokenStat_1 = require("../stat/service/tool/FixDailyTokenStat");
const utils_1 = require("../stat/service/common/utils");
class DataEntry {
}
class Context {
    constructor() {
        this.txMap = new Map();
        this.testMode = false;
        this.sameFeeCount = 0;
        this.diffFeeCount = 0;
        this.logCounter = 0;
    }
}
async function main() {
    const [, , cmd, arg1, arg2] = process.argv;
    const cfg = await (0, FixDailyTokenStat_1.init)();
    let cfx = await (0, utils_1.initCfxSdk)(cfg.conflux);
    let epochMaxInclude = await cfx.getEpochNumber();
    const ctx = new Context();
    if (cmd === 'test') {
        ctx.testMode = true;
    }
    loadTxTask(epochMaxInclude, ctx.txMap, 100);
    loadReceiptTask(ctx, cfx);
    updateGas(ctx);
    (0, ProcessTool_1.regExitHook)();
}
function fatal() {
    process.exit(1);
}
async function updateGas(ctx) {
    let id = 0;
    while (true) {
        const de = ctx.txMap.get(id);
        if (de?.id < 0) {
            break;
        }
        if (!de?.receipts?.length) {
            console.log(`receipt is not ready. id ${id}`);
            await (0, ProcessTool_1.sleep)(1000);
            continue;
        }
        ctx.txMap.delete(id);
        id++;
        const dbTxByHash = new Map();
        de.tx.forEach((transaction) => {
            dbTxByHash.set(transaction.hash, transaction);
        });
        for (const arrOfBlock of de.receipts) {
            for (const rcpt of arrOfBlock) {
                if (rcpt.outcomeStatus != 0 || rcpt.epochNumber !== de.epoch
                    // crossing space tx
                    || rcpt.gasFee == 0) {
                    if (ctx.testMode) {
                        console.log(`skip tx status ${rcpt.outcomeStatus}  gasFee ${rcpt.gasFee} epoch ${rcpt.epochNumber}`);
                    }
                    continue;
                }
                // tx
                const dbTx = dbTxByHash.get(rcpt.transactionHash);
                if (!dbTx) {
                    console.log(`db tx is missing, epoch ${rcpt.epochNumber} , hash ${rcpt.transactionHash}`);
                    console.log(`db tx , there are:\n`, [...dbTxByHash.keys()].join('\n'));
                    rcpt.logs = rcpt.logsBloom = undefined; // remove long data before logging
                    console.log(`receipt detail:\n`, rcpt);
                    fatal();
                }
                dbTxByHash.delete(rcpt.transactionHash);
                // if (ctx.logCounter % 1000 === 0) {
                // 	console.log(`db gas: ${dbTx.gas} , receipt gas fee ${rcpt.gasFee} , tx ${rcpt.transactionHash}`);
                // }
                ctx.logCounter++;
                if (dbTx.gas == rcpt.gasFee) {
                    ctx.sameFeeCount++;
                }
                else if (ctx.testMode) {
                    ctx.diffFeeCount++;
                    console.log(`diff ! db ${dbTx.gas} vs ${rcpt.gasFee} receipt , tx ${rcpt.transactionHash}`);
                }
                else {
                    ctx.diffFeeCount++;
                    await FullBlock_1.FullTransaction.update({
                        gas: rcpt.gasFee,
                    }, {
                        where: { epoch: rcpt.epochNumber, hash: rcpt.transactionHash },
                        logging: ctx.testMode ? console.log : false,
                        limit: 1,
                    });
                }
                if (ctx.logCounter % 1000 === 1) {
                    console.log(`epoch ${de.epoch} , sameFeeCount ${ctx.sameFeeCount} diffFeeCount ${ctx.diffFeeCount}`);
                }
            }
        }
        if (dbTxByHash.size > 0) {
            console.log(`db tx remains, there are:\n`, [...dbTxByHash.keys()].join('\n'));
            fatal();
        }
    }
}
async function loadReceiptTask(ctx, cfx) {
    const txMap = ctx.txMap;
    let id = 0;
    while (true) {
        const de = txMap.get(id);
        if (de?.id < 0) {
            break;
        }
        if (!de?.txReady) {
            console.log(`db tx is not ready. id ${id}`);
            await (0, ProcessTool_1.sleep)(1000);
            continue;
        }
        const rr = await cfx.getEpochReceipts(de.epoch).catch(e => {
            console.log(`failed to load receipts for ${de.epoch}: ${e}`);
            return null;
        });
        if (!rr) {
            await (0, ProcessTool_1.sleep)(3000);
            continue;
        }
        de.receipts = rr;
        id++;
    }
}
async function loadTxTask(epochMaxInclude, map, mapSize) {
    let id = 0;
    while (true) {
        if (map.size >= mapSize) {
            console.log(`tx pool is full. id ${id}`);
            await (0, ProcessTool_1.sleep)(1000);
            continue;
        }
        const { list, nextEpoch } = await loadTx(epochMaxInclude, mapSize);
        if (nextEpoch === 0) {
            break;
        }
        let useDataEntry = null;
        list.forEach(entry => {
            if (!useDataEntry || useDataEntry.epoch !== entry.epoch) {
                useDataEntry && (useDataEntry.txReady = true);
                useDataEntry = {
                    id: id++, epoch: entry.epoch, tx: [], receipts: [],
                };
                map.set(useDataEntry.id, useDataEntry);
            }
            useDataEntry.tx.push(entry);
        });
        useDataEntry && (useDataEntry.txReady = true);
        epochMaxInclude = nextEpoch;
    }
    // indicates stop
    map.set(id++, { epoch: 0, id: -1, receipts: [], tx: [] });
}
async function loadTx(epochMaxInclude, limit) {
    const all = await FullBlock_1.FullTransaction.findAll({
        attributes: ['epoch', 'hash', 'gas'],
        where: { epoch: { [sequelize_1.Op.lte]: [epochMaxInclude] }, status: 0, gas: { [sequelize_1.Op.ne]: 0 } },
        order: [['epoch', 'desc'], ['blockPosition', 'desc'], ['txPosition', 'desc']],
        limit
    });
    if (!all.length) {
        console.log(`no transaction found, epoch <= ${epochMaxInclude}`);
        return { list: [], nextEpoch: 0 };
    }
    // drop tail records, they may be incomplete of an epoch
    const last = all[all.length - 1];
    const list = all.filter(row => row.epoch > last.epoch);
    return { list, nextEpoch: last.epoch };
}
if (module == require.main) {
    main();
}
// node tools/FixTxGasFee.js
