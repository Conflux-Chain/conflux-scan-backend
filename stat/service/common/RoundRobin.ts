export class RoundRobin {
    data:number[] = []
    len:number
    cursor = 0
    sum = 0
    constructor(len:number) {
        this.len = len || 1
    }
    push(v:number) {
        const pre = this.data[this.cursor] || 0
        this.sum += v - pre
        this.data[this.cursor] = v
        this.cursor = (this.cursor + 1) % this.len
    }

    avg() {
        return this.sum / this.len
    }
}