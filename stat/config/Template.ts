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
    /*
     * Consensus layer cumulative withdrawals, the only external input the published
     * supply has. Empty here on purpose: it is per deployment, and the empty default
     * is what makes "nobody configured this" visible in the code rather than being a
     * property that simply does not exist on some hosts.
     *
     * Every process that runs `checkIssuance` or `calculateEvmPosSupply` needs it --
     * that is the API process *and* StatTask, which is how it was missed: it was set
     * by hand on the API host only, and the issuance monitor on the sync host alerted
     * `validatorRpc is not set` 36 times before anyone connected the two.
     */
    validatorRpc: '',
    // delay ms.
    syncTxnCountHistory: false,
    syncCfxHolderCountDaily: false,
    serverTag: 'scan-stat-1',
    erc20watchList:[],
    watchCfxBalance: false,
};
