
export function calBeginEndTime(day: Date): { beginTime: Date, endTime: Date }{
    const beginTime = new Date(day);
    beginTime.setHours(0, 0, 0, 0);
    const endTime = new Date(day);
    endTime.setDate(endTime.getDate() + 1);
    endTime.setHours(0, 0, 0, 0);
    return {beginTime, endTime};
}

export function getYesterday(day: Date){
    const date = new Date(day);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 1);
    return date;
}

export function getNextDelay(day: Date, intervalDay: number, intervalMin: number): number{
    if(intervalDay === 0){
        return intervalMin*60*1000;
    }

    const beginTime = new Date(day);
    const beginMilliSec = beginTime.getTime();
    beginTime.setHours(0, 0, 0, 0);
    beginTime.setDate(beginTime.getDate() + intervalDay);
    const endMilliSec = beginTime.getTime();

    const delay = endMilliSec - beginMilliSec + intervalMin*60*1000;
    return delay;
}

export function getTimeByInterval(day: Date, intervalMin: number = undefined,
                                  intervalHour: number = undefined,
                                  intervalDay: number = undefined){
    const time = new Date(day);
    time.setMinutes(time.getMinutes() + (intervalMin ? intervalMin : 0));
    time.setHours(time.getHours() + (intervalHour ? intervalHour : 0));
    time.setDate(time.getDate() + (intervalDay ? intervalDay : 0));
    return time;
}