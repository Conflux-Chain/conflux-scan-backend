import {Epoch} from "./Epoch";
import {Op} from "sequelize";

/**
 * When using raw query, there is an issue about timezone, under sqlite3.
 * Avoid passing date directly, convert it to utc string.
 * @param dt
 */
export function fmtDtUTC(dt: Date) : string {
    return dt.toISOString()
        .replace('T', ' ')
        .replace('Z', '')
        .concat(' +00:00')
}

export async function getEpochRange(beginDt: Date, endDt: Date, showLog = false) {
    const [startEpoch, endEpoch] = await Promise.all([
        Epoch.findOne({where: {timestamp:{[Op.gte]:beginDt}}, order:[['timestamp','asc']],
            logging: showLog ? console.log : false,
        }),
        Epoch.findOne({where: {timestamp:{[Op.lte]:endDt}}, order:[['timestamp','desc']],
            logging: showLog ? console.log : false,
        })
    ])
    return [startEpoch, endEpoch].map(e=>{
        return e?.epoch || 0
    })
}

export function adjustTodayEndTime(end: Date, showLog = false) {
    const today = new Date()
    if (end.getTime() > today.getTime()) {
        // half day
        const minutes = today.getMinutes()
        // uniform time range
        end.setMinutes(0, 0, 0);
        showLog && console.log(`half day, set end time to ${end.toISOString()} now ${today.toISOString()}`)
    }
}

export function pickNumber(v, defaultV) {
    return isNaN(v) ? defaultV : parseInt(v)
}
export function calculateBeginTime(n: number, type: string, endDt: Date): Promise<Date> {
    let beginDt:Date;
    switch (type) {
        case 'h':
            if (n > 24){
                return Promise.reject(`too large hour span ${n}`)
            }
            beginDt = new Date(endDt.getTime())
            beginDt.setMinutes(0,0,0)
            addUTCMinutes(beginDt, -60*(n)) // calculate time by minutes
            break;
        case 'd':
            if (n > 90) { // 24 * 90 = 2160
                return Promise.reject(`too large day span ${n}`)
            }
            beginDt = new Date(endDt.getTime())
            beginDt.setMinutes(0,0,0);
            addUTCMinutes(beginDt, -60*24*(n)) // calculate time by minutes
            break;
        default:
            return Promise.reject(`unknown type ${type}, support [h|d]`);
    }
    return Promise.resolve(beginDt)
}

export function addUTCMinutes(dt: Date, n: number) {
    dt.setUTCMinutes(dt.getUTCMinutes() + n)
    return dt;
}
