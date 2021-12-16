class CallTime {
    times = 0
    ms = 0
}
export class Measure {
    times = 0
    map:Map<string, CallTime> = new Map<string, CallTime>()
    m(tag:string, start) {
        let t = this.map.get(tag)
        if (!t) {
            t = new CallTime()
            this.map.set(tag, t)
        }
        t.times += 1
        t.ms += Date.now() - start
    }
    call<T>(tag:string, fn:()=>Promise<T>) : Promise<T> {
        const start = Date.now()
        return fn().then(res=>{
            this.times ++
            this.m(tag, start)
            return res;
        })
    }
    dump(msg:string, mod = 1, ...specialKey:string[]) {
        if (this.times % mod !== 0) {
            return;
        }
        const buildInfo = (keys:string[]) => {
            return keys.map(k=>{
                const t = this.map.get(k);
                return t ? `${k}:${(t.ms/(t.times || 1)).toPrecision(5)}=${t.ms}/${t.times}` : ''
            }).join('; ');
        }
        let specialInfo = buildInfo(specialKey)
        specialKey.forEach(k=>this.map.delete(k))

        const info = buildInfo([...this.map.keys()])
        console.log(`${msg} avg=sum/times: ${specialInfo} ${info}`)
        this.times = 0
        this.map.clear()
    }
}