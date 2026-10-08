const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {format} = require('js-conflux-sdk');

const root = path.resolve(__dirname, '../..');
function loadSource(file, mocks = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    vm.runInNewContext(code, {
        exports, module: {exports}, process, console,
        require: name => {
            if (name in mocks) return mocks[name];
            if (name.startsWith('.')) throw new Error(`Unmocked dependency: ${name}`);
            return require(name);
        },
    }, {filename: file});
    return exports;
}

const mapping = loadSource('stat/service/common/CrossSpaceAddress.ts');
const coreHex = '12bf6283ccf8ad6ffa63f7da63edc217228d839a';
const mappedHex = '6460d0d3c01a2a66044acdf5bc58d3284d4ab9c5';
const coreAddress = 'cfx:aakn82yd3x6m4594pt57y29r2jnwfdpdxjxcwskv05';

function resolver({row = {coreHex}, addressExists = true, networkId = 1029} = {}) {
    const calls = [];
    const service = loadSource('open-api/service/OpenDataService.ts', {
        '../../stat/service/common/utils': {},
        '../../stat/model/HexMap': {
            Hex40Map: {findOne: async options => {
                calls.push(options.where);
                return addressExists ? {id: 17, hex: options.where.hex} : null;
            }},
            ESpaceHex40Map: {findOne: async options => {
                calls.push(options.where);
                return row;
            }},
        },
        '../../stat/StatApp': {StatApp: {networkId}, fmtAddr: format.address},
        '../router/middleware': {setBody: (ctx, data) => { ctx.body = data; }},
        '../../stat/router/ParamChecker': {},
        '../../stat/service/common/LogicError': {Errors: {ParameterError: Error}},
        '../../stat/service/common/CrossSpaceAddress': mapping,
    });
    return {resolve: service.resolveCoreSpaceAddress, calls};
}
const context = address => ({request: {query: {eSpaceAddress: address}}});

test('known Core bytes hash to the mapped eSpace address', () => {
    assert.equal(format.hexAddress(coreAddress), `0x${coreHex}`);
    assert.equal(mapping.mappedEspaceHex(coreHex), mappedHex);
});

test('resolves indexed mapping to original Core bytes, including mixed-case input', async () => {
    const {resolve, calls} = resolver();
    const ctx = context(`0x${mappedHex.toUpperCase()}`);
    await resolve(ctx);
    assert.equal(ctx.body.coreSpaceAddress, coreAddress);
    assert.equal(ctx.body.eSpaceAddress, ctx.request.query.eSpaceAddress);
    assert.equal(JSON.stringify(calls), JSON.stringify([{hex: mappedHex}, {hexId: 17}]));
});

test('uses configured Core network', async () => {
    const {resolve} = resolver({networkId: 1});
    const ctx = context(`0x${mappedHex}`);
    await resolve(ctx);
    assert.equal(ctx.body.coreSpaceAddress, format.address(`0x${coreHex}`, 1));
});

test('rejects the reported same-byte alias instead of re-encoding it', async () => {
    await assert.rejects(resolver().resolve(context(`0x${coreHex}`)), /not found/);
});

test('rejects absent, legacy, malformed and mismatched mappings', async () => {
    for (const row of [null, {}, {coreHex: 'bad'}, {coreHex: '1'.repeat(40)}]) {
        await assert.rejects(resolver({row}).resolve(context(`0x${mappedHex}`)), /not found/);
    }
    const {resolve, calls} = resolver({addressExists: false});
    await assert.rejects(resolve(context(`0x${mappedHex}`)), /not found/);
    assert.equal(calls.length, 1);
});

test('rejects invalid input before querying storage', async () => {
    for (const address of [undefined, '', [], `0x${'g'.repeat(40)}`, coreAddress]) {
        const {resolve, calls} = resolver();
        await assert.rejects(resolve(context(address)), /Invalid eSpace address/);
        assert.equal(calls.length, 0);
    }
});
