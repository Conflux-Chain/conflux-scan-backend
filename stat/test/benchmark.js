
const _ = require("js-conflux-sdk/src/rpc/trace")
const formatRaw = require("js-conflux-sdk/src/util/format")
// console.log(`that is `, formatRaw.blockTraces);
const origin = formatRaw.blockTraces;
formatRaw.blockTraces = (v)=>{
  // console.log(`call me`)
  const start = Date.now();
  const ret = origin(v)
  ret.elapsedMs = Date.now() - start;
  // console.log(`exit me`)
  return ret;
}
const {format} = require("js-conflux-sdk")

const args = process.argv.slice(2)
function testFormatHex(times) {
  let start = Date.now()
  let i = 0;
  let base32 = 'NET2:TYPE.CONTRACT:ACDN7TWA43SFBYRKE21UR1V9AP5H8ZN3HPH95FA02U'
  while (i < times) {
    format.hexAddress(base32)
    i++
  }
  let cost = Date.now() - start
  console.log(`run ${times} cost ${cost}ms, avg ${cost/times}`)
}

if (module === require.main) {
  testFormatHex(Number(args[0]))
}
