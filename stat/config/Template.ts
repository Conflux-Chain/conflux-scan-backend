export default {
    /** api configurations */
    serverTag: 'scan-server',
    port: 8087,
    apiPort: 9527,
    v1port: 8895,
    diffMonitorPort: -1000,

    /** blockchain rpc configurations */
    conflux: null,

    /** persistence configurations */
    database: null,
    influxDB: null,
    oss: null,

    /** sync configurations */
    firstBlockNo: 0,
    watchCfxBalance: true,
    useGetLogs: false,
    getLogsRange: 100,
    getLogsJobCount: 100,
    getLogsDbBatchSize: 100,

    /** 0g configurations */
    noCoreSpace: false,
    noTopToken: false,
    traceNotAvailable: false,
    pendingTxNotAvailable: false,
    onlyStatActiveContract: false,
    validatorRpc: "",

    /** log configurations */
    requestLogger: {
        enable: false,
        level: 'info',
        format: 'json',
        request: { method: true, url: true, query: true, header: true },
        response: { status: true, message: true, duration: true },
    },

    /** billing configurations */
    billingApp: "",

    /** alert configurations */
    dingTalkToken: null,
    dingDevToken: null,
    tgToken: null,
    tgChatId: null,

    /** address configurations */
    // censor
    censor: {
        enable: true,
        appId: null,
        apiKey: null,
        secretKey: null,
    },

    /** token configurations */
    // price
    quote: {
        enable: true,
        binanceAccessToken: null,
        coinMarketCapAccessToken: null,
    },

    /** contract configurations */
    // verify
    verification: {
        enable: true,
        url: null,
    },
};
