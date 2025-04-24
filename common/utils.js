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


if (module === require.main) {
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
      message = JSON.stringify(message, null, 4);
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
