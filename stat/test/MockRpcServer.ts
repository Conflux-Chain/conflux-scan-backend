async function run() {
    const Koa = require('koa');
    const app = new Koa();

    function rndId() {
        return Math.round(Math.random() * 10)
    }
    app.use(async (ctx) => {
        ctx.body = {
            "jsonrpc": "2.0",
            "id": 10,
            "result": [
                {"address": "0x83928828f200b79b78404dce3058ba0c8c4076c3", "tokenId": `1${rndId()}`},
                {"address": "0x83928828f200b79b78404dce3058ba0c8c4076c3", "tokenId": `2${rndId()}`},
                {"address": "0x83928828f200b79b78404dce3058ba0c8c4076c3", "tokenId": `3${rndId()}`},
                {"address": "0x83928828f200b79b78404dce3058ba0c8c4076c3", "tokenId": `4${rndId()}`},
                {"address": "0x83928828f200b79b78404dce3058ba0c8c4076c3", "tokenId": `5${rndId()}`},
                {"address": "0x83928828f200b79b78404dce3058ba0c8c4076c3", "tokenId": `6${rndId()}`},
            ]
        }
    })
    app.listen(9527);
}

run().then()