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

export function pickNumber(v, defaultV) {
    return isNaN(v) ? defaultV : v
}
export function calculateBeginTime(n: number, type: string, endDt: Date): Promise<Date> {
    let beginDt:Date;
    switch (type) {
        case 'h':
            if (n > 24){
                return Promise.reject(`too large hour span ${n}`)
            }
            endDt.setMinutes(0,0,0)
            beginDt = new Date(endDt.getTime())
            addUTCMinutes(beginDt, -60*(n)) // calculate time by minutes
            break;
        case 'd':
            if (n > 90) { // 24 * 90 = 2160
                return Promise.reject(`too large day span ${n}`)
            }
            endDt.setMinutes(0,0,0);
            beginDt = new Date(endDt.getTime())
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