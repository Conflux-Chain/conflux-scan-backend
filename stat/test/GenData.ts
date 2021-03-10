function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}


export function rnd(max) {
    return getRandomInt(0, max)
}
export function hex(n: number) : string {
    return Array.from(Array(n).keys()).map(i=>( i===0 ? 1 : rnd(16)).toString(16)).join('')
}

export function hex64(){
    return hex(64)
}