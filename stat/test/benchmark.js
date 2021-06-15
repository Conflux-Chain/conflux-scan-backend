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
testFormatHex(Number(args[0]))