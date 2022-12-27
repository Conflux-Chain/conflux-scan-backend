const Module = require('module');
const fs = require('fs');
const lodash = require('lodash');
const fastDiff = require('fast-diff');
const readline = require('readline');
const error = require('./error');
const {PerformanceObserver, performance} = require("perf_hooks");
// ----------------------------------------------------------------------------
let running = true;

process.on('SIGINT', () => {
  console.log('receive signal [SIGINT]');
  running = false;
});
process.on('SIGTERM', () => {
  console.log('receive signal [SIGTERM]');
  running = false;
});
process.on('tool.js, unhandledRejection', (e) => {
  console.error(e); // eslint-disable-line no-console
  running = false;
});

function isRunning() {
  return running;
}

function memInfo(){
  const format = function(bytes) {
    return `${(bytes/1024/1024).toFixed(2)}MB`;
  };
  const mem = process.memoryUsage();
  return `Process: heapTotal ${format(mem.heapTotal)}, heapUsed ${format(mem.heapUsed)}, rss ${format(mem.rss)}`
}


// ----------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms)); // sleep
}

function assert(bool, message) {
  if (!bool) {
    throw new error.ParameterError(lodash.isString(message) ? message : JSON.stringify(message));
  }
}

function isExist(object, schema) {
  return lodash.every(schema, (bool, key) => {
    const value = lodash.get(object, key);
    switch (bool) {
      case true:
        return value !== undefined;
      case false:
        return value === undefined;
      default:
        return true;
    }
  });
}

function checkExist(object, rule) {
  lodash.forEach(rule, (bool, key) => {
    const value = lodash.get(object, key);
    switch (bool) {
      case true:
        if (value === undefined) {
          throw new error.ParameterError(JSON.stringify({ message: `"${key}" is required`, rule, object }));
        }
        break;
      case false:
        if (value !== undefined) {
          throw new error.ParameterError(JSON.stringify({ message: `expect "${key}" to be undefined`, rule, object }));
        }
        break;
      default:
        break;
    }
  });
}

function addHex(hex, int) {
  if (hex === undefined) {
    return undefined;
  }

  const bigInt = BigInt(hex) + BigInt(int);
  if (bigInt < 0) {
    return undefined;
  }

  const string = bigInt.toString(16);
  if (string.length + 2 > hex.length) {
    return undefined;
  }

  return `0x${lodash.repeat('0', hex.length - 2 - string.length)}${string}`;
}

async function awaitObject(object) {
  const result = {};
  await Promise.all(lodash.map(object, async (promise, key) => {
    result[key] = await promise;
  }));
  return result;
}

function timestampToString(timestamp, zone = +8) {
  const REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z$/;
  const date = new Date(timestamp + zone * 3600 * 1000);
  const [_, year, month, day, hour, minute, second] = date.toISOString().match(REGEX) || {}; // eslint-disable-line no-unused-vars
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

// function calculateSimilarity(x, y) {
//   x = Buffer.isBuffer(x) ? x.toString() : x;
//   y = Buffer.isBuffer(y) ? y.toString() : y;
//
//   let unionCount = 0;
//   let intersectionCount = 0;
//   const array = fastDiff(x, y);
//   array.forEach(([code, string]) => {
//     unionCount += string.length;
//     if (code === 0) {
//       intersectionCount += string.length;
//     }
//   });
//
//   return unionCount > 0 ? intersectionCount / unionCount : 1;
// }

// ----------------------------------------------------------------------------
function requireJs(js, filename = '') {
  const module = new Module(filename);
  module._compile(js, filename);
  return module.exports;
}

function readFile(filename) {
  try {
    return fs.readFileSync(filename).toString();
  } catch (e) {
    return undefined;
  }
}

function readNodeModules(filename) {
  for (const path of require.main.paths) {
    try {
      return fs.readFileSync(`${path}/${filename}`).toString();
    } catch (e) {
      // pass
    }
  }
  return undefined;
}

function readCommonContract(filename) {
  try {
    return fs.readFileSync(`${__dirname}/contract/${filename}`).toString();
  } catch (e) {
    return undefined;
  }
}

// ----------------------------------------------------------------------------
function parseTransactionMessage(string) {
  let type = 7;
  let message = string;
  if (string === 'Vm reverted, ') {
    type = 5;
    message = '';
  } else if (string === 'VmError(OutOfGas)') {
    type = 4;
    message = '';
  } else if (string === 'VmError(ExceedStorageLimit)') {
    type = 2;
    message = '';
  } else if (string.startsWith('NotEnoughCash')) {
    type = 3;
    message = string.replace('NotEnoughCash ', '');
  } else if (string.startsWith('Vm reverted, ')) {
    type = 1;
    message = string.replace('Vm reverted, ', '');
  } else if (string.startsWith('VmError(BadInstruction ')) {
    type = 6;
    message = string.replace('VmError(BadInstruction ', '');
  }
  return { type, message };
}

/*
* 按行读取文件内容
* 返回：字符串数组
* 参数：fReadName:文件名路径
*      callback:回调函数
* */
function readFileToArr(filename, callback) {
  const fRead = fs.createReadStream(`${__dirname}/contract/${filename}`);
  const objReadline = readline.createInterface({
    input: fRead,
  });
  const arr = [];
  objReadline.on('line', (line) => {
    arr.push(line);
    // console.log('line:'+ line);
  });
  objReadline.on('close', () => {
    console.log(arr.join('\\n'));
    // callback(arr);
  });
}

// ----------------------------------------------------------------------------
function extractEncodedConstructorArgs(creationData, compiledCreationBytecode) {
  return "0x" + creationData.slice(compiledCreationBytecode.length);
}

function enablePerformance(types = ['measure', "function"]) {
  const { PerformanceObserver, performance } = require('perf_hooks');
  const obs = new PerformanceObserver((items) => {
    console.log(`items`, items.getEntries().map(e=>{
      return ` ${e.duration.toString().padStart(15, ' ')} ${e.name}`// , type ${e.entryType} `
    }).join('\n'))
    // apparently you should clean up...
    // performance.clearMarks();
    // performance.clearMeasures(); // Not a function in Node.js 12
  });
  obs.observe({ entryTypes: types });
}
function performance_mark(pre, cur) {
  performance.mark(cur);
  if (pre) {
    performance.measure(`${cur}`, pre, cur)
  }
  return cur;
}
function buildSqlLog(tag) {
  return (...args)=>{
    console.log(tag, ...args);
  }
}
// ----------------------------------------------------------------------------

module.exports = {
  isRunning,
  memInfo,
  enablePerformance, performance_mark, buildSqlLog,
  sleep,
  assert,
  isExist,
  checkExist,
  addHex,
  awaitObject,
  timestampToString,
  // calculateSimilarity,

  requireJs,
  readFile,
  readNodeModules,
  readCommonContract,

  parseTransactionMessage,
  extractEncodedConstructorArgs,
};

// const filename = 'FC.sol';
// readFileToArr(filename);
