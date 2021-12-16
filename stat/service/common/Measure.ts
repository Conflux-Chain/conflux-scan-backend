class CallTime {
    times = 0
    ms = 0
    veryStart = 0
    veryEnd = 0
}
export class Measure {
    times = 0
    map:Map<string, CallTime> = new Map<string, CallTime>()
    checkEntry(tag:string) {
        let t = this.map.get(tag)
        if (!t) {
            t = new CallTime()
            t.veryStart = Date.now()
            this.map.set(tag, t)
        }
        t.veryEnd = Date.now()
        return t;
    }
    m(tag:string, start) {
        const t = this.checkEntry(tag)
        t.times += 1
        t.ms += Date.now() - start
    }
    count(tag:string, cnt:number) {
        const t = this.checkEntry(tag)
        t.times+=1;
        t.ms += cnt;
    }
    async call<T>(tag:string|boolean, fn:()=>Promise<T>) : Promise<T> {
        if (!tag) {
            return fn();
        }
        const start = Date.now();
        // console.log(` start ${tag} ${start}`)
        return fn().then(res=>{
            this.times ++
            this.m(tag as string, start)
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
                return t ? `${k}:${(t.ms/(t.times || 1)).toPrecision(5)}=${t.ms}/${t.times
                }(${t.veryStart}-${t.veryEnd})` : ''
            }).join('; \n');
        }
        let specialInfo = buildInfo(specialKey)
        specialKey.forEach(k=>this.map.delete(k))

        const info = buildInfo([...this.map.keys()])
        console.log(`${msg} avg=sum/times: ${specialInfo} ${info}`)
        this.times = 0
        this.map.clear()
    }
}