const addressSdk = require('js-conflux-sdk/src/util/address')
const superagent = require('superagent')
const { initCfxSdk } = require('../../dist/service/common/utils');

async function getTx(acc) {
  return page(acc, `${host}/v1/transaction`)
}
async function page(acc, url, param) {
  const arr = []
  let size = 100;
  let skip = 0
  let total = 0;
  do {
    let query = {limit: 100, skip, reverse: false, ...param};
    if (acc) {
      query.accountAddress = acc
    }
    const resp = await superagent.get(`${url}`)
      .query(query)
      .catch(err => {
        console.log(`fail ${url}`, err.response.body || err)
      })
    const body = resp.body;
    total = body.total
    arr.push(...body.list)
    console.log(`${url.substr(url.lastIndexOf('/'))} total ${body.total}, list ${body.list.length}`)
    skip += size;
  } while(skip < total)
  return arr;
}
async function getStaking(txHash) {
  console.log(`tx hash ${txHash}`)
  return page('', `${host}/v1/transfer`, {transactionHash:txHash, transferType:'CFX'})
}
async function getTransfer(acc, type) {
  return page(acc, `${host}/v1/transfer`, {transferType:'CFX'})
}
async function getAccount(acc) {
  return cfx.getAccount(acc)
}

async function getStakingInternalTrace(arrTx, addr1, addr2) {
  //
  const stakingTrace = []
  for (const obj of arrTx) {
    if (obj.to === addr1 || obj.to === addr2) {
      const stakingTr = await getStaking(obj.hash)
      stakingTrace.push(...stakingTr)
    }
  }
  return stakingTrace;
}
async function getSponsorTx(arrTx, addr1, addr2) {
  const sponsorTx = []
  for (const obj of arrTx) {
    if (obj.to === addr1 || obj.to === addr2) {
      console.log(`sponsor tx hash ${obj.hash}`)
      sponsorTx.push(await cfx.getTransactionByHash(obj.hash))
    }
  }
  return sponsorTx;
}
async function run() {
  cfx = await initCfxSdk({url:`${host}/rpcv2`});
  const arrTxAll = await getTx(acc)
  const arrTx = arrTxAll.filter(obj=>obj.status === 0)
  const stakingTrace = await getStakingInternalTrace(arrTx, staking, stakingVerbose);
  const sponsorTrace = await getSponsorTx(arrTx, sponsor, sponsorVerbose);
  // console.log(`sponsor tx:`, sponsorTrace[0])
  // console.log(`staking:`,stakingTrace[0])
  // console.log(`tx `, arrTx[0].to)
  const arrTransfer = await getTransfer(acc)
  await dump(arrTx, 'tx\t', false)
  await dump(arrTransfer, 'trace\t', false)
  await dump(stakingTrace, 'staking\t', false)
  await dump(sponsorTrace, 'sponsor\t', false)
  //
  const curAcc = await getAccount(acc)
  console.log(`current balance ${curAcc.balance} = ${curAcc.balance/BigInt(1e+18)}, staking ${curAcc.stakingBalance}`)
  console.log(`account ${acc}`)
}
async function dump(arr, tag, detail) {
  // console.log(`transfer `, arr[0])
  let sum = 0n
  let sponsorCnt = 0
  let stakingCnt = 0
  const str = arr.map(obj=> {
    let to = addressSdk.simplifyCfxAddress(obj.to);
    obj.to = to;
    let ban = acc === to ? obj.value: -obj.value;
    sum += BigInt(ban)
    sponsorCnt += to === sponsor ? 1 : 0
    stakingCnt += to === staking ? 1 : 0
    return `from ${addressSdk.simplifyCfxAddress(obj.from)
    } to ${to
    } value ${ ban}`;
  }).join('\n')
  if(detail)console.log(`${tag} result:\n${str}`)
  console.log(`${tag} final balance: ${sum} = ${sum/BigInt(1e+18)}, sponsor count ${sponsorCnt}, staking count ${stakingCnt}`)
}
let host = 'https://confluxscan.io';
let cfx;
let acc = ''
const sponsor = 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaaegg2r16ar'
const sponsorVerbose = 'CFX:TYPE.BUILTIN:AAEJUAAAAAAAAAAAAAAAAAAAAAAAAAAAAEGG2R16AR'
const staking = 'cfx:aaejuaaaaaaaaaaaaaaaaaaaaaaaaaaaajrwuc9jnb'
const stakingVerbose = 'CFX:TYPE.BUILTIN:AAEJUAAAAAAAAAAAAAAAAAAAAAAAAAAAAJRWUC9JNB'
run().then()