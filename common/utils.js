const {base64, base58, randomBytes} = require("ethers/lib/utils");
function uniquePromise(map, key, fun) {
  // eslint-disable-next-line no-return-assign
  return map[key] || (map[key] = fun());
}

function withoutCfxTransferType(callType) {
  return callType === 'none'
  || callType === 'callcode'
  || callType === 'delegatecall'
  || callType === 'staticcall';
}

function randomString(length) {
  let result = '';
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function base58key(suffix = '') {
  console.log(`random string`)
  let randomStr = randomString(32 - suffix.length) + suffix;
  console.log(randomStr, randomStr.length)
  let encoded = base58.encode(Buffer.from(randomStr));
  console.log(encoded, encoded.length);
  console.log(Buffer.from(base58.decode(encoded)).toString())
}

if (module === require.main) {
  const [,,cmd, arg1] = process.argv;
  if (cmd === 'gen-key') {
    base58key(arg1)
  } else if (cmd === 'decode-key') {
    console.log(`input`, arg1, arg1.length)
    console.log(`decoded`)
    let decoded = Buffer.from(base58.decode(arg1)).toString();
    console.log(decoded, decoded.length)
  }
}
module.exports = { uniquePromise, withoutCfxTransferType };
