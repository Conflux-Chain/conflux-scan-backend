import {DataTypes, Model, Sequelize} from "sequelize";
import {ConfigInstance} from "../config/StatConfig";
import {dingMsg} from "./Monitor";

export interface IErrorLog {
	id: number;
	module: string; // sync, v1, stat, open
	biz: string;
	detail: string;
	count: number;
	updatedAt: Date;
}

export class ErrorLog extends Model<IErrorLog> implements IErrorLog {
	id: number;
	module: string; // sync, v1, stat, open
	biz: string;
	detail: string;
	count: number;
	updatedAt: Date;
	static register(sequelize: Sequelize) {
		ErrorLog.init({
			id: {type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true},
			module: {type: DataTypes.STRING(128), allowNull: false,},
			biz: {type: DataTypes.STRING(256), allowNull: false,},
			detail: {type: DataTypes.TEXT({length: "long"}), allowNull: false,},
			count: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 1},
			updatedAt: {type: DataTypes.DATE, allowNull: false},
		}, {
			sequelize, tableName: 'error_log',
			indexes: [
				{name: 'idx_module_biz', fields: ['module', 'biz'], unique: true},
				{name: 'idx_updatedAt', fields: ['updatedAt']}
			]
		})
	}
}

const ALERT_THROTTLE_MS = 3600_000;
/*
 * A ceiling on top of the per-error throttle. `biz` is built as
 * `json-rpc-500-${e.message}` and an error message can carry request input, so
 * the number of distinct keys is not ours to bound: probe traffic on
 * 2026-10-13 produced twelve of them in under two hours. Without this, each
 * fresh payload would buy itself another alert.
 */
const MAX_ALERTS_PER_HOUR = 6;
/* Same reason -- the key space is caller-controlled, so the map needs an end. */
const MAX_TRACKED_KEYS = 500;

const alertCtx = {
	/* key -> last alerted at. Insertion order is kept least-recently-alerted first. */
	lastAlertAt: new Map<string, number>(),
	windowStartMs: 0,
	windowCount: 0,
}

/**
 * One alert per (module, biz) per hour, rather than one per process per hour.
 *
 * The throttle this replaces was a single timestamp shared by every caller, so
 * the whole StatTask process emitted at most one alert an hour and whichever
 * error arrived first silenced every other one until the next. A transient
 * EPIPE from the database was enough to do it -- 22 of them over 101 days, each
 * self-healing, each costing an hour of everything else's visibility.
 */
function mayAlert(module: string, biz: string): boolean {
	const now = Date.now();

	// The global cap is checked first, so a flood of new keys cannot outrun it.
	if (now - alertCtx.windowStartMs >= ALERT_THROTTLE_MS) {
		alertCtx.windowStartMs = now;
		alertCtx.windowCount = 0;
	}
	if (alertCtx.windowCount >= MAX_ALERTS_PER_HOUR) {
		return false;
	}

	const key = `${module}|${biz}`;
	const last = alertCtx.lastAlertAt.get(key);
	if (last !== undefined && now - last < ALERT_THROTTLE_MS) {
		return false;
	}

	// delete before set: Map keeps the original position when a key is merely
	// overwritten, which would make the eviction below drop the wrong entry.
	alertCtx.lastAlertAt.delete(key);
	alertCtx.lastAlertAt.set(key, now);
	while (alertCtx.lastAlertAt.size > MAX_TRACKED_KEYS) {
		alertCtx.lastAlertAt.delete(alertCtx.lastAlertAt.keys().next().value);
	}

	alertCtx.windowCount += 1;
	return true;
}

/**
 * Recorded in error_log, but never paged for.
 *
 * Deliberately not part of isKnownError(), which drops an error before it is
 * written and so leaves no trace at all. These faults are transient and every
 * caller already recovers -- the TimerStat loop reschedules 60 seconds later --
 * but the count still has to move, because a rate that climbs from one every
 * few days to one a minute is a database going down, and that must stay visible
 * in the table even though nobody is woken for any single occurrence.
 *
 * EPIPE reaches here wrapped: SequelizeDatabaseError carries `write EPIPE` as
 * its message and the code on `parent`/`original`, so matching the top-level
 * `code` alone -- the way the ECONNRESET entry in isKnownError() does -- would
 * never fire.
 */
function isTransientError(e: any): boolean {
	const code = e?.code || e?.parent?.code || e?.original?.code;
	return code === 'EPIPE' || e?.message === 'write EPIPE';
}

async function reportError(eLog: ErrorLog, error: Error) {
	if (isTransientError(error)) {
		return;
	}
	if (!mayAlert(eLog.module, eLog.biz)) {
		return;
	}
	const dingToken = ConfigInstance.dingDevToken || ConfigInstance.dingTalkToken;
	if (!dingToken) {
		return
	}
	const {module, biz, detail, count: times} = eLog;
	await dingMsg(`There was an error:\n${error.message}\nmodule: ${module
	}\nbusiness: ${biz}\ntimes: ${times}\ndetail: ${detail}`, dingToken);
}

export function isKnownError(e) {
	return e.code === 'ECONNREFUSED'
		|| e.code === 'ABORTED'
		|| e.code === 'ECONNRESET'
		|| e.code === 'ERR_INVALID_CHAR'
		|| e.message === 'Inconsistent state: pivot hash mismatch'
		|| e.message?.includes('connection refused')
		|| e.message?.includes('out-of-bound StateAvailabilityBoundary')
		|| e.message === 'Error processing request: state is not ready'
		|| e.message?.includes('timeout')
		|| e.message?.includes('connection')
		|| (e.data instanceof String && e.data?.includes('is not executed, the latest state epoch is'))
		;
}

export async function safeAddErrorLog(module: string, biz: string, error: Error) {
	if (!error || isKnownError(error)) {
		return;
	}
	try {
		await addErrorLog(module, biz, error);
	} catch (e) {
		console.log(`failed to record error`, e)
	}
}

async function addErrorLog(module: string, biz: string, error: Error) {
	if (!ErrorLog.sequelize) {
		return;
	}
	if (biz.length > 256) {
		biz = biz.substring(0, 256);
	}
	let detail = JSON.stringify(error, null, 4);
	if (detail.length < 3) {
		detail = `${error}`;
	}
	if (detail.length < 3) {
		detail = `${error.message}\n${error.stack}`;
	}
	let bean = await ErrorLog.findOne({where: {module, biz}}).catch(e=>{
		console.log(`failed to find error log bean`, e.message);
		return null;
	});
	if (bean) {
		bean.count += 1;
		bean.detail = detail;
		await bean.save().catch(e=>{
			console.log(`failed to record error`, e.message);
		});
	} else {
		[bean] = await ErrorLog.upsert({
			module, biz, detail: detail, count: 1,
		}).catch(e=>{
			console.log(`failed to upsert error`, e.message);
			return [bean];
		})
	}
	await reportError(bean, error)
}
