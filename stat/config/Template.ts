// Place a Local.ts if you want change these configuration.
export default {
    port: 8087,
    conflux: { url: 'http://main.confluxrpc.org/v2' },
    cfxWsUrl: '',
    dingTalkToken: '',
    database: {
        // sqlitePath: './data/database.sqlite',
        database: '',
        user: '',
        pwd: '',
        host: '',
        port: 3306,
        // zero stand for unlimited
        blockTableRowsLimit: 10_0000,
        syncSchema: false,
    },
    scanApiUrl: 'https://testnet-scantest.confluxnetwork.org',
    scanJsonRpcUrl: 'http://127.0.0.1:8895',
    // delay ms.
    syncTxnCountHistory: false,
    syncCfxHolderCountDaily: false,
    serverTag: 'scan-stat-1',
    erc20watchList:[],
    watchCfxBalance: false,
};
