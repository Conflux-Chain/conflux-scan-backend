

const m = new Map();
m.set("aaa", {"fullName": 'fullNamexxx'});
const r1 = m.get("aaa")?.["fullName"];
console.log(`r1 ===`, r1);
const r2 = m.get("aaa")["fullName2"];
console.log(`r2 ===`, r2);
const r3 = m.get("bbb")?.["fullName2"];
console.log(`r3 ===`, r3);


