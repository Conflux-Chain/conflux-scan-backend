// eslint-disable-next-line no-unused-vars
export default {
    port: 8087,
    syncRPC: '', // test net
    scanApiUrl1: 'https://confluxscan.io/rpc', // test secondary
    scanApiUrl: 'http://47.242.158.149:8895', // prod secondary
    conflux: { url: 'http://localhost:12538' },
    database: {
        // sqlitePath: './data/prod.sqlite',
        USE_MYSQL: true,
        database: 'scan',
        user: 'kang',
        pwd: 'Kang95@7',
        host: '120.53.121.70',
    },
};
