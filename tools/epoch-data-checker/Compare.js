"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareRows = exports.normalize = void 0;
function normalize(value) {
    if (value instanceof Date)
        return value.getTime();
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value))
        return value.slice(2).toLowerCase();
    if (value && typeof value.toJSON === 'function' && value.constructor !== Object) {
        return normalize(value.toJSON());
    }
    if (Array.isArray(value))
        return value.map(normalize);
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => {
            if (value[k] !== undefined)
                out[k] = normalize(value[k]);
        });
        return out;
    }
    return value;
}
exports.normalize = normalize;
function compareRows(expected, actual, keyOf, fields) {
    const e = new Map(expected.map(row => [keyOf(row), row]));
    const a = new Map(actual.map(row => [keyOf(row), row]));
    const differences = [];
    e.forEach((row, key) => {
        if (!a.has(key))
            differences.push({ kind: 'missing', key, expected: normalize(row) });
    });
    a.forEach((row, key) => {
        if (!e.has(key))
            differences.push({ kind: 'extra', key, actual: normalize(row) });
    });
    e.forEach((row, key) => {
        const other = a.get(key);
        if (!other)
            return;
        fields.forEach(field => {
            const rawLeft = row[field];
            const rawRight = other[field];
            const left = typeof rawLeft === 'boolean' && (rawRight === 0 || rawRight === 1) ? rawLeft : normalize(rawLeft);
            const right = typeof rawRight === 'boolean' && (rawLeft === 0 || rawLeft === 1) ? Boolean(rawRight) : normalize(rawRight);
            if (JSON.stringify(left) !== JSON.stringify(right)) {
                differences.push({ kind: 'field', key: `${key}.${field}`, expected: left, actual: right });
            }
        });
    });
    return differences;
}
exports.compareRows = compareRows;
