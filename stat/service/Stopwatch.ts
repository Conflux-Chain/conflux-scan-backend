export class Stopwatch {
    entries:Entry[] = []
    last:Entry = null
    public start(name: string) {
        const now = new Date().getTime()
        if (this.last !== null) {
            this.last.finish(now)
            this.entries.push(this.last)
        }
        this.last = new Entry(name, now)
    }

    public stop() {
        const now = new Date().getTime()
        this.last.finish(now)
        this.entries.push(this.last)
        this.last = null
    }

    public dump(title: string) {
        this.last !== null && this.stop()
        const content = this.entries.map(e=>`${e.name} costs ${e.elapse}`).join(';')
        console.log('stopwatch dump:', title, content)
    }
}
export class Entry {
    name:string
    start: number
    end:number
    elapse:number
    constructor(name:string, ms: number) {
        this.name = name
        this.start = ms
    }
    public finish(ms: number) {
        this.end = ms;
        this.elapse = ms - this.start
    }
}