import {Contract} from "../model/Contract";
import {Op} from "sequelize";
import {safeAddErrorLog} from "../monitor/ErrorMonitor";
import {Token} from "../model/Token";
import {NameTag} from "../model/NameTag";
import {KEY_OFFICIAL_LABELS, KV} from "../model/KV";
import {formatToBase32} from "../model/HexMap";
import {VerifiedContracts} from "../model/VerifiedContracts";
import {Conflux, format} from "js-conflux-sdk";
import {CONST} from "./common/constant";
import {NAME_TAG_SPLIT} from "./EpochSync";
import {TokenSecurityAudit} from "../model/TokenSecurityAudit";

const REGEX_URL = /^(https?:\/\/(([a-zA-Z0-9]+-?)+[a-zA-Z0-9]+\.)+[a-zA-Z]+)(:\d+)?(\/.*)?(\?.*)?(#.*)?$/;

export class TokenSecurityAuditSync{
    private OFFICIAL_LABEL_FLUSH_INTERVAL = 180_000; // 3 min
    private officialLabelLoadTimestamp;
    private officialLabels: Set<string> = new Set<string>();
    private cfx: Conflux;

    constructor({cfx}: { cfx: Conflux }) {
        this.cfx = cfx;
        this.scheduleRecently().then();
        this.scheduleOverall().then();
    }

    async scheduleRecently(interval = 1000 * 5) { // default 5s
        return this.schedule(interval, true);
    }

    async scheduleOverall(interval = 1000 * 60 * 60) { // default 1h
        return this.schedule(interval, false);
    }

    private async schedule(interval, recently) {
        const that = this;

        async function repeat() {
            await that.audit(recently).catch(err=>{
                safeAddErrorLog('stat-task', 'token-audit', err).then();
                console.log(`token audit fail: `, err);
            })
            setTimeout(repeat, interval);
        }

        repeat().then();
        console.log(`[${TokenSecurityAudit.getTableName()}]schedule in ${interval/1000}s interval`);
    }

    private async audit(recently: boolean = false){
        const opt: any = {attributes: ['base32'], raw: true};
        const now = new Date();
        if(recently) { // Audit those whose tokeninfo/nametag have changed from the last 24 hours.
            const minTime = new Date(now);
            minTime.setDate(minTime.getDate() - 1);

            const nameTags = await NameTag.findAll({
                attributes: ['base32'], where: {updatedAt: {[Op.gte]: minTime}}, raw: true,
            } as any);

            const conditions: any[] = [
                {createdAt: {[Op.gte]: minTime}}
            ];

            if (nameTags.length) {
                conditions.push({
                    base32: {[Op.in]: nameTags.map(nameTag => nameTag.base32)}
                });
            }

            opt.where = conditions.length === 1
                ? conditions[0]
                : {[Op.or]: conditions};
        }

        const tokens = await Token.findAll(opt);
        let addresses = tokens?.map(item => (item.base32));
        for(const address of addresses){
            await this.auditByAddress(address);
        }

        const tokenSet = new Set([...addresses]);
        const contracts = await Contract.findAll(opt);
        addresses = contracts?.map(item => (item.base32)).filter(item => (!tokenSet.has(item)));
        for(const address of addresses){
            await this.auditByAddress(address);
        }

        !recently && console.log('Token security audit executed', {
            start: now.toISOString(),
            end: new Date().toISOString(),
        });
    }

    private async auditByAddress(address) {
        // load official labels periodically
        if (!this.officialLabels.size ||
            (Date.now() - this.officialLabelLoadTimestamp >= this.OFFICIAL_LABEL_FLUSH_INTERVAL)) {
            const cautionLabels = await KV.getString(KEY_OFFICIAL_LABELS, '');
            cautionLabels.split(',').forEach(label => this.officialLabels.add(label));
            this.officialLabelLoadTimestamp = Date.now();
        }

        const base32 = formatToBase32(address);
        const account = await this.cfx.getAccount(base32).catch(err => {
            const msg = `${err}`
            if (msg.includes("Epoch number larger than the current pivot chain tip")) {
                return null;
            }
            throw err;
        });

        const token = await Token.findOne({attributes: ['id', 'hex40id'], where: {base32}});
        if (token) {
            const verifiedContract = await VerifiedContracts.findOne({where: {address: base32}});
            const zeroAdmin = account?.admin && (format.hexAddress(account.admin) === CONST.ZERO_ADDRESS);

            const nameTag = await NameTag.findOne({where: {base32}});
            const officialLabels = nameTag?.labels?.split(NAME_TAG_SPLIT)
                .filter(label => this.officialLabels.has(label)).join(NAME_TAG_SPLIT) || null;

            await TokenSecurityAudit.upsert({
                hex40id: token.hex40id,
                base32,
                verify: !!verifiedContract,
                zeroAdmin,
                officialLabels,
                updatedAt: new Date(),
            } as any);

            const securityCredits = await this.calSecurityCredits(base32);
            await Token.update({securityCredits}, {where: {base32}});
        }

        const destroyed = account?.codeHash === CONST.CODEHASH_NO_BYTECODE;
        if (destroyed) {
            await Token.sequelize.transaction(async dbTx => {
                return Promise.all([
                    Token.update({destroyed}, {transaction: dbTx, where: {base32}}),
                    Contract.update({destroyed}, {transaction: dbTx, where: {base32}}),
                ]);
            });
        }
    }

    private async calSecurityCredits(base32): Promise<number> {
        const {
            verify,
            audit,
            sponsor,
            zeroAdmin,
            cexBinance,
            cexHuobi,
            cexOKEx,
            dexMoonSwap,
            trackCoinMarketCap,
            officialLabels,
        } = (await TokenSecurityAudit.findOne({where: {base32}, raw: true})) || {};

        let credits = 0;

        credits += [verify, audit, sponsor, zeroAdmin].filter(Boolean).length;
        credits += [cexBinance, cexHuobi, cexOKEx].filter(item => item?.trim()?.match(REGEX_URL)).length > 0 ? 1 : 0;
        credits += [dexMoonSwap].filter(item => item?.trim()?.match(REGEX_URL)).length > 0 ? 1 : 0;
        credits += [trackCoinMarketCap].filter(item => item?.trim()?.match(REGEX_URL)).length > 0 ? 1 : 0;
        credits += officialLabels?.split(NAME_TAG_SPLIT).length > 0 ? 10 : 0;

        return Promise.resolve(credits);
    }
}

