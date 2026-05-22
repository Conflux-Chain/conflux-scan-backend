"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const KoaRouter = __importStar(require("koa-router"));
const HomepageDashboard_1 = require("../../stat/service/HomepageDashboard");
const { router_get } = require("../../koaflow/src/koaHelper");
const { Drip } = require('js-conflux-sdk');
const { formatDecimal } = require('../../stat/service/common/utils');
const router = new KoaRouter();
router_get(router, '/circulating', 
// eslint-disable-next-line prefer-arrow-callback
async function () {
    const { totalCirculating, nullAddressBalance, } = HomepageDashboard_1.HomepageDashboard.getData()?.supplyInfo || { totalCirculating: 0, nullAddressBalance: 0, };
    if (totalCirculating == 0) {
        return "";
    }
    return formatDecimal(Drip(`${BigInt(totalCirculating) - BigInt(nullAddressBalance)}`).toCFX(), 2);
});
router_get(router, '/total', 
// eslint-disable-next-line prefer-arrow-callback
async function () {
    const data = HomepageDashboard_1.HomepageDashboard.getData()?.supplyInfo || { totalIssued: 0, nullAddressBalance: 0 };
    // @ts-ignore
    const { totalIssued, nullAddressBalance } = data;
    if (totalIssued == 0) {
        return "";
    }
    return formatDecimal(Drip(`${BigInt(totalIssued) - BigInt(nullAddressBalance)}`).toCFX(), 2);
});
module.exports = router;
