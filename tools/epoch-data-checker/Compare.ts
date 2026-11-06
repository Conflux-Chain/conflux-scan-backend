export interface Difference {
    kind: string;
    key: string;
    expected?: any;
    actual?: any;
}

export function normalize(value: any): any {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'bigint') return value.toString();
    if (value && typeof value.toJSON === 'function' && value.constructor !== Object) {
        return normalize(value.toJSON());
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
        const out: any = {};
        Object.keys(value).sort().forEach(k => {
            if (value[k] !== undefined) out[k] = normalize(value[k]);
        });
        return out;
    }
    return value;
}

export function compareRows(expected: any[], actual: any[], keyOf: (row: any) => string,
                            fields: string[]): Difference[] {
    const e = new Map(expected.map(row => [keyOf(row), row]));
    const a = new Map(actual.map(row => [keyOf(row), row]));
    const differences: Difference[] = [];
    e.forEach((row, key) => {
        if (!a.has(key)) differences.push({kind: 'missing', key, expected: normalize(row)});
    });
    a.forEach((row, key) => {
        if (!e.has(key)) differences.push({kind: 'extra', key, actual: normalize(row)});
    });
    e.forEach((row, key) => {
        const other = a.get(key);
        if (!other) return;
        fields.forEach(field => {
            const left = normalize(row[field]);
            const right = normalize(other[field]);
            if (JSON.stringify(left) !== JSON.stringify(right)) {
                differences.push({kind: 'field', key: `${key}.${field}`, expected: left, actual: right});
            }
        });
    });
    return differences;
}
