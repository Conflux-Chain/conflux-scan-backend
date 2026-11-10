export interface Difference {
    kind: string;
    key: string;
    expected?: any;
    actual?: any;
    detail?: string;
}

export function normalize(value: any): any {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'boolean') return value;
    // Hashes can be returned by RPC with a 0x prefix while Sequelize stores
    // the same value without it. Compare both representations identically.
    if (typeof value === 'string' && /^(?:0x)?[0-9a-f]{64}$/i.test(value)) return value.replace(/^0x/i, '').toLowerCase();
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

function booleanValue(value: any): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (text === 'true' || text === '1') return true;
        if (text === 'false' || text === '0') return false;
    }
    // Some MySQL drivers expose TINYINT values as one-byte buffers.
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value) && value.length === 1 && (value[0] === 0 || value[0] === 1)) {
        return value[0] === 1;
    }
    return undefined;
}

function valuesEqual(left: any, right: any): boolean {
    const leftBoolean = booleanValue(left);
    const rightBoolean = booleanValue(right);
    // Only enter boolean mode when one side is explicitly boolean (or uses
    // the textual boolean spelling). This avoids turning ordinary numeric
    // fields whose value happens to be 0 or 1 into booleans.
    const explicitBoolean = typeof left === 'boolean' || typeof right === 'boolean' ||
        (typeof left === 'string' && /^(?:true|false)$/i.test(left.trim())) ||
        (typeof right === 'string' && /^(?:true|false)$/i.test(right.trim())) ||
        (typeof Buffer !== 'undefined' && (Buffer.isBuffer(left) || Buffer.isBuffer(right)));
    if (explicitBoolean && leftBoolean !== undefined && rightBoolean !== undefined) return leftBoolean === rightBoolean;
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
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
            const rawLeft = row[field];
            const rawRight = other[field];
            if (!valuesEqual(rawLeft, rawRight)) {
                differences.push({kind: 'field', key: `${key}.${field}`, expected: normalize(rawLeft), actual: normalize(rawRight)});
            }
        });
    });
    return differences;
}
