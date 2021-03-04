// @ts-ignore
import {Conflux, Provider, format} from "js-conflux-sdk";
const superagent = require("superagent")
const prefix = require( "superagent-prefix" )

async function run() {
    const url = ''
    // const cfx = new Conflux({url})
    const scanUrl = 'https://confluxscan.io/v1'
    const client = superagent
    let transferType = 'ERC1155'
    transferType = 'ERC20'
    const is1155 = transferType === 'ERC1155'
    client.get(`${scanUrl}/token`)
        .query({
            fields: '',
            limit: 100,
            skip: 0,
            transferType
        }).end((err, res) => {
        console.log('err:', err)
        // res.body = JSON.parse(res.body)
        let list = res.body.list
        list = list.filter(token=>token.symbol === 'cAMP' || token.symbol === 'cDPI')
        console.log(`conf:`)
        list.forEach(token=>{
            let hexAddr = format.hexAddress(token.address)
            console.log(`${JSON.stringify({name: token.symbol, address: hexAddr, watchDelay: 100, tokenType: transferType.toLowerCase()})},`)
        })
        console.log(`\n model:`)
        list.forEach(token=>{
            console.log(`export class Balance_${token.symbol} extends Balance{
    static register(seq){
        Balance.register(seq, Balance_${token.symbol}, 'balance_${token.symbol}')
    }
}`)
        })
        console.log(`\n watcher:`)
        list.forEach(token=>{
            console.log(`case '${token.symbol}':         ret = Balance_${token.symbol};    break;`)
        })
        console.log(`\n register:`)
        list.forEach(token=>{
            console.log(`Balance_${token.symbol}.register(sequelize);`)
        })
        console.log(`\n create table:`)
        list.forEach(token=>{
            console.log(`create table balance_${token.symbol}
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);`)
        })
        // console.log('res:', res.body)
    });
}
run().then()