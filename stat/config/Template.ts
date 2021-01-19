// Place a Local.ts if you want change these configuration.
export default {
    port: 8087,
    conflux: { url: '' },
    database: {
        // sqlitePath: './data/database.sqlite',
        database: '',
        user: '',
        pwd: '',
        host: '',
        // zero stand for unlimited
        blockTableRowsLimit: 10_0000,
        // delay ms.
        syncBlockDelay: 100,
        // delay ms.
        syncTxnDelay: 100,
    },
};