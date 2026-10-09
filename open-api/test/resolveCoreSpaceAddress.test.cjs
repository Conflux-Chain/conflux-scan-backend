const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {format} = require('js-conflux-sdk');

const source = fs.readFileSync(path.join(__dirname, '../service/OpenDataService.ts'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;
const coreHex = '12bf6283ccf8ad6ffa63f7da63edc217228d839a';
const mappedHex = '6460d0d3c01a2a66044acdf5bc58d3284d4ab9c5';
const coreAddress = 'cfx:aakn82yd3x6m4594pt57y29r2jnwfdpdxjxcwskv05';
class ParameterError extends Error {}

function resolver({mapping = {hexId: 17}, address = {hex: coreHex}, networkId = 1029} = {}) {
    const calls = [];
    const mocks = {
        '../../stat/service/common/utils': {},
        '../../stat/model/HexMap': {
            ESpaceHex40Map: {findOne: async options => {
                calls.push({table: 'e_space_hex40', ...options});
                return mapping;
            }},
            Hex40Map: {findByPk: async (id, options) => {
                calls.push({table: 'hex40', id, ...options});
                return address;
            }},
        },
        '../../stat/StatApp': {StatApp: {networkId}, fmtAddr: format.address},
        '../router/middleware': {setBody: (ctx, data) => { ctx.body = data; }},
        '../../stat/router/ParamChecker': {},
        '../../stat/service/common/LogicError': {Errors: {ParameterError}},
    };
    const exports = {};
    vm.runInNewContext(code, {
        exports, module: {exports},
        require: name => {
            if (name in mocks) return mocks[name];
            if (name.startsWith('.')) throw new Error(`Unmocked dependency: ${name}`);
            return require(name);
        },
    }, {filename: 'OpenDataService.ts'});
    return {resolve: exports.resolveCoreSpaceAddress, calls};
}
const context = address => ({request: {query: {eSpaceAddress: address}}});

test('follows e_space_hex40.hexId to hex40.id using only existing columns', async () => {
    const {resolve, calls} = resolver();
    const ctx = context(`0x${mappedHex.toUpperCase()}`);
    await resolve(ctx);
    assert.equal(ctx.body.coreSpaceAddress, coreAddress);
    assert.equal(ctx.body.eSpaceAddress, ctx.request.query.eSpaceAddress);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
        {table: 'e_space_hex40', attributes: ['hexId'], where: {hex: mappedHex}, raw: true},
        {table: 'hex40', id: 17, attributes: ['hex'], raw: true},
    ]);
});

test('uses the configured Core network and accepts uppercase stored hex', async () => {
    const {resolve} = resolver({address: {hex: coreHex.toUpperCase()}, networkId: 1});
    const ctx = context(`0x${mappedHex}`);
    await resolve(ctx);
    assert.equal(ctx.body.coreSpaceAddress, format.address(`0x${coreHex}`, 1));
});

test('passes database bigint IDs through without losing precision', async () => {
    const id = '9007199254740993';
    const {resolve, calls} = resolver({mapping: {hexId: id}});
    await resolve(context(`0x${mappedHex}`));
    assert.equal(calls[1].id, id);
});

test('rejects a missing mapping without querying hex40', async () => {
    const {resolve, calls} = resolver({mapping: null});
    await assert.rejects(resolve(context(`0x${mappedHex}`)), ParameterError);
    assert.equal(calls.length, 1);
});

test('rejects missing, malformed, same-byte and mismatched linked addresses', async () => {
    for (const address of [null, {}, {hex: 'bad'}, {hex: mappedHex}, {hex: '1'.repeat(40)}]) {
        await assert.rejects(resolver({address}).resolve(context(`0x${mappedHex}`)), ParameterError);
    }
    await assert.rejects(resolver().resolve(context(`0x${coreHex}`)), ParameterError);
});

test('rejects invalid input before querying storage', async () => {
    for (const address of [undefined, '', [], `0x${'g'.repeat(40)}`, coreAddress]) {
        const {resolve, calls} = resolver();
        await assert.rejects(resolve(context(address)), ParameterError);
        assert.equal(calls.length, 0);
    }
});
