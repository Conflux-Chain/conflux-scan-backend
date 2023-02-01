import {CONST as SDK_CONST} from "js-conflux-sdk";

const moment = require('moment');

export abstract class TimerStat {
    protected app: any;
    protected baseInterval: IntervalType;
    protected debug = false;

    protected constructor(app: any) {
        this.app = app;
    }

    protected abstract bizAlias(): string;

    protected abstract nextStatRange(): Promise<{rangeBegin: Date, rangeEnd: Date}>;

    protected abstract firstEpochAfterRangeEnd(rangeEnd): Promise<number>;

    protected abstract stat(rangeBegin: Date, rangeEnd: Date);

    public async schedule(delay = 1000 * 60 * 10) {
        const that = this;

        async function repeat() {
            await that.doStat().catch(e => { console.log(`[${that.bizAlias()}]stat error: `, e) });
            setTimeout(repeat, delay);
        }

        repeat().then();
        const delayTag = delay > 1000 ? `${delay/1000}s` : `${delay}ms`
        console.log(`[${that.bizAlias()}]schedule in ${delayTag} interval`);
    }

    protected async doStat() {
        const {status, rangeBegin, rangeEnd} = await this.checkPivotBlockTime();
        this.debug && console.log(`debug-4,status:${status},rangeBegin:${rangeBegin},rangeEnd:${rangeEnd}`);
        if(status !== StatStatus.STAT_ABLE) {
            return;
        }

        await this.stat(rangeBegin, rangeEnd);
    }

    protected async checkPivotBlockTime(): Promise<{status: StatStatus, rangeBegin?: Date, rangeEnd?: Date}> {
        const { cfx } = this.app;

        const {rangeBegin, rangeEnd} = await this.nextStatRange();
        this.debug && console.log(`debug-1,rangeBegin:${rangeBegin},rangeEnd:${rangeEnd}`);
        if(new Date() < rangeEnd) {
            return {status: StatStatus.TIME_NOT_REACH};
        }

        const epochDB = await this.firstEpochAfterRangeEnd(rangeEnd);
        this.debug && console.log(`debug-2,epochDB:${epochDB}`);
        if(epochDB === undefined || isNaN(epochDB)){
            return {status: StatStatus.EPOCH_NOT_SYNC};
        }

        const epochFinalized = await cfx.getEpochNumber(SDK_CONST.EPOCH_NUMBER.LATEST_FINALIZED);
        this.debug && console.log(`debug-3,epochDB:${epochDB},epochFinalized:${epochFinalized}`);
        if(epochDB > epochFinalized){
            return {status: StatStatus.EPOCH_NOT_FINAL};
        }

        return {status: StatStatus.STAT_ABLE, rangeBegin, rangeEnd};
    }

    protected supportInterval(beginTime, endTime, exceptInterval: IntervalType): { intervalType: string, intervalSec: number } {
        let intervalType;
        const intervalByMinutes = (endTime.getTime() - beginTime.getTime())/ (1000 * 60);
        switch (intervalByMinutes){
            case 1:
                intervalType = IntervalType.MIN; break;
            case 10:
                intervalType = IntervalType.TEN_MIN; break;
            case 60:
                intervalType = IntervalType.HOUR; break;
            case 1440:
                intervalType = IntervalType.DAY; break;
            default:
                throw new Error(`interval not supported, ${beginTime.toLocaleString()}-${endTime.toLocaleString()}`);
        }

        if(intervalType !== exceptInterval){
            throw new Error(`interval not supported, expect:${exceptInterval}, get:${intervalType}`);
        }

        return {intervalType, intervalSec: intervalByMinutes * 60};
    }

    protected getRangeBegin(endTime: Date, rangeType: IntervalType): Date{
        let rangeStart = new Date(endTime);
        if(rangeType === IntervalType.DAY){
            rangeStart.setHours(0, 0, 0, 0);
        } else if (rangeType === IntervalType.HOUR){
            rangeStart.setMinutes(0, 0, 0);
        } else {
            throw new Error(`range not supported, ${rangeType}`);
        }

        if(moment(endTime).format('HH:mm') === '00:00' && rangeType === IntervalType.DAY){
            rangeStart.setDate(rangeStart.getDate() - 1);
        }
        if (moment(endTime).format('mm:ss') === '00:00' && rangeType === IntervalType.HOUR){
            rangeStart.setHours(rangeStart.getHours() - 1);
        }

        return rangeStart;
    }

    protected getStatRangeMin(lastStat, minutes: number): {rangeBegin: Date, rangeEnd: Date}{
        if(!lastStat){
            const rangeBegin = new Date('2020-10-28 16:00:00');
            const rangeEnd = new Date(rangeBegin);
            rangeEnd.setMinutes(rangeEnd.getMinutes() + minutes);
            return { rangeBegin, rangeEnd };
        }

        const lastStatTime = lastStat.statTime || lastStat.statDay;
        const rangeBegin = new Date(lastStatTime);
        rangeBegin.setMinutes(rangeBegin.getMinutes() + minutes);
        const rangeEnd = new Date(lastStatTime);
        rangeEnd.setMinutes(rangeEnd.getMinutes() + minutes * 2);
        return { rangeBegin, rangeEnd };
    }

    protected getStatRangeDay(lastStat, days: number): {rangeBegin: Date, rangeEnd: Date}{
        if(!lastStat){
            const rangeBegin = new Date('2020-10-28 16:00:00');
            const rangeEnd = new Date(rangeBegin);
            rangeEnd.setDate(rangeEnd.getDate() + days);
            return { rangeBegin, rangeEnd };
        }

        const lastStatTime = lastStat.statTime || lastStat.statDay;
        const rangeBegin = new Date(lastStatTime);
        rangeBegin.setDate(rangeBegin.getDate() + days);
        const rangeEnd = new Date(lastStatTime);
        rangeEnd.setDate(rangeEnd.getDate() + days * 2);
        return { rangeBegin, rangeEnd };
    }
}

export enum StatStatus {
    STAT_ABLE,
    TIME_NOT_REACH,
    EPOCH_NOT_SYNC,
    EPOCH_NOT_FINAL,
}

export enum IntervalType {
    MIN = '1m',
    TEN_MIN = '10m',
    HOUR = '1h',
    DAY = '1d',
}
