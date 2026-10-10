const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../service/DBProvider.ts'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

const tableNames = {
    Token: 'token',
    TokenSecurityAudit: 'token_security_audit',
    VerifiedContracts: 'verified_contracts',
    Contract: 'contract',
    DailyNFTStat: 'daily_nft_stat',
    DailyPosRewardStat: 'daily_pos_reward_stat',
    DailyPowRewardStat: 'daily_pow_reward_stat',
    TraceCreateContract: 'trace_create_contract',
    KV: 'config',
    ContractImpl: 'contract_impl',
};

function loadProvider() {
    // Stub model registration and unrelated initialization; run the real migration helpers.
    const mocks = new Proxy({}, {
        get: (_, name) => {
            if (name === 'NoCoreSpace') return false;
            if (typeof name === 'string' && /^[A-Z]/.test(name)) {
                return {
                    register() {},
                    getTableName: () => {
                        assert.ok(tableNames[name], `Unexpected migration model: ${name}`);
                        return tableNames[name];
                    },
                };
            }
            if (typeof name === 'string' && (name.startsWith('create')
                || ['addNameSymbolFailureColumn', 'bindBundleTxModels'].includes(name))) {
                return async () => {};
            }
            throw new Error(`Unexpected dependency: ${String(name)}`);
        },
    });
    const exports = {};
    vm.runInNewContext(code, {
        exports, module: {exports},
        console: {log() {}, error() {}},
        require: name => name === 'sequelize' ? require(name) : mocks,
    }, {filename: 'DBProvider.ts'});
    return exports;
}

function legacyDatabase() {
    const tables = {
        token: {},
        token_security_audit: {},
        verified_contracts: {libraries: {type: 'VARCHAR(1024)'}},
        contract: {},
        daily_nft_stat: {statType: {type: 'CHAR(2)'}},
        daily_pos_reward_stat: {statType: {type: 'CHAR(2)'}},
        daily_pow_reward_stat: {statType: {type: 'CHAR(2)'}},
        trace_create_contract: {codeHash: {type: 'CHAR(64)', allowNull: false}},
        config: {value: {type: 'VARCHAR(1024)'}},
        contract_impl: {proxyType: {type: 'VARCHAR(16)'}},
    };
    const indexes = new Set();
    const writes = [];
    const definition = options => ({...options, type: options.type.toString()});
    const qi = {
        async describeTable(table) {
            if (!tables[table]) throw new Error(`No description found for ${table}`);
            return tables[table];
        },
        async addColumn(table, column, options) {
            assert.equal(tables[table][column], undefined, `Duplicate column: ${table}.${column}`);
            tables[table][column] = definition(options);
            writes.push({operation: 'addColumn', table, column});
        },
        async changeColumn(table, column, options) {
            assert.ok(tables[table][column], `Missing column: ${table}.${column}`);
            tables[table][column] = definition(options);
            writes.push({operation: 'changeColumn', table, column});
        },
        async addIndex(table, fields, options) {
            const key = `${table}.${options.name}`;
            assert.equal(indexes.has(key), false, `Duplicate index: ${key}`);
            indexes.add(key);
            writes.push({operation: 'addIndex', table, fields: Array.from(fields)});
        },
    };
    const seq = {
        authenticate: async () => {},
        sync: async () => assert.fail('Upgrading existing tables must not depend on sync()'),
        getQueryInterface: () => qi,
        async query(sql) {
            const match = /^SHOW INDEX FROM `([^`]+)` WHERE Key_name = '([^']+)'$/.exec(sql);
            assert.ok(match, `Unexpected SQL: ${sql}`);
            const [, table, name] = match;
            if (!tables[table]) {
                const error = new Error(`Table ${table} does not exist`);
                error.parent = {code: 'ER_NO_SUCH_TABLE'};
                throw error;
            }
            return [indexes.has(`${table}.${name}`) ? [{Key_name: name}] : [], {}];
        },
    };
    qi.sequelize = seq;
    return {seq, qi, tables, indexes, writes};
}

test('initModel upgrades an older schema without calling sync()', async () => {
    const db = legacyDatabase();
    await loadProvider().initModel(db.seq);

    assert.equal(db.tables.verified_contracts.similarMatchChainId.type, 'INTEGER');
    assert.equal(db.tables.verified_contracts.similarMatchAddress.type, 'CHAR(64)');
    assert.equal(db.tables.contract_impl.beaconId.type, 'BIGINT');
    assert.equal(db.tables.contract_impl.beaconId.allowNull, false);
    assert.equal(db.tables.contract_impl.beaconId.defaultValue, 0);
    assert.equal(db.tables.verified_contracts.libraries.type, 'VARCHAR(2048)');
    assert.equal(db.tables.config.value.type, 'VARCHAR(8192)');
    assert.equal(db.writes.filter(write => write.operation === 'addColumn').length, 14);
    assert.equal(db.writes.filter(write => write.operation === 'changeColumn').length, 7);
    assert.equal(db.indexes.size, 5);
});

test('repeated initialization does not recreate existing columns or indexes', async () => {
    const db = legacyDatabase();
    const provider = loadProvider();
    await provider.initModel(db.seq);
    const upgradedSchema = JSON.stringify(db.tables);
    db.writes.length = 0;

    await provider.initModel(db.seq);
    assert.equal(JSON.stringify(db.tables), upgradedSchema);
    assert.equal(db.writes.filter(write => write.operation === 'addColumn').length, 0);
    assert.equal(db.writes.filter(write => write.operation === 'addIndex').length, 0);
});

test('absent tables are left for model table creation', async () => {
    const db = legacyDatabase();
    for (const table of Object.keys(db.tables)) delete db.tables[table];

    await loadProvider().initModel(db.seq);
    assert.equal(db.writes.length, 0);
});

test('initialization rejects an upgrade failure', async () => {
    const db = legacyDatabase();
    const failure = new Error('ALTER TABLE permission denied');
    db.qi.addColumn = async () => { throw failure; };

    await assert.rejects(loadProvider().initModel(db.seq), error => error === failure);
});
