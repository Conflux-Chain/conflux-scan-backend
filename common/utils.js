const {base64, base58, randomBytes} = require("ethers/lib/utils");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
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
  } else {
    console.log(`usage <gen-key|decode-key> arg1`)
  }
}
function createLogger(tag, label_, dirname, level='info', silent = false) {
  const { combine, timestamp, label, printf } = winston.format;
  const myFormat = printf(({ level, message, label, timestamp, stack }) => {
    if (stack) {
      const str = stack
      let firstLine = str.substr(0, str.indexOf('\n'))
      firstLine = firstLine.substr(firstLine.indexOf(":")+1)
      const idx = message.indexOf(firstLine)
      if (idx >= 0) {
        message = message.substr(0, idx)
      }
      return `${timestamp} [${label}] ${level}: ${message}\n${stack}`;
    } else if (typeof message === 'object') {
      message = JSON.stringify(message);
    }
    return `${timestamp} [${label}] ${level}: ${message}`;
  });
  return winston.createLogger({
    level,
    format: combine(
        label({ label: label_ }),
        timestamp(),
        myFormat
    ),
    defaultMeta: { tag },
    transports: [
      new winston.transports.Console({silent}),
      new DailyRotateFile({dirname,
        filename: 'error.%DATE%.log', level: 'error',
        maxSize: '500mb', maxFiles: '20d', createSymlink: true, symlinkName: 'error.log'
      }),
      new DailyRotateFile({dirname,
        filename: 'info.%DATE%.log', level: 'info',
        maxSize: '500mb', maxFiles: '20d', createSymlink: true, symlinkName: 'info.log'
      }),
    ],
  });
}
module.exports = { uniquePromise, withoutCfxTransferType, createLogger };
