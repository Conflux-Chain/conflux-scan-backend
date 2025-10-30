const crypto = require('crypto');
const zlib = require('zlib');
const {type} = require('../koaflow/lib/type');
const { format } = require('js-conflux-sdk');

type.unsigned = type.integer.$validate((v) => v >= 0);
type.hex40 = type.string.$validate((v) => /^0x[0-9a-f]{40}$/.test(v), 'hex40').$parse((v) => v.toLowerCase());
type.hex64 = type.string.$validate((v) => /^0x[0-9a-f]{64}$/.test(v), 'hex64').$parse((v) => v.toLowerCase());
type.bigInt = type(BigInt);
type.address = type(format.hexAddress);

type.intToHex = type.int
  .$after((v) => v.toString(16))
  .$after((v) => (v.length % 2 ? `0x0${v}` : `0x${v}`));

type.hexToBuffer = type((hex) => (hex.startsWith('0x') ? hex.slice(2) : hex))
  .$after((v) => (v.length % 2 ? `0${v}` : v))
  .$after((v) => Buffer.from(v, 'hex'))
  .$or(null);

type.bufferToHex = type.buffer
  .$after((v) => `0x${v.toString('hex')}`)
  .$or(null);

type.numberToBigInt = type.number
  .$after(Math.round)
  .$after(BigInt);

type.base64ToString = type.buffer
  .$parse((v) => Buffer.from(v, 'base64'))
  .$after(String);

type.solcVersion = type.buffer
  .$after((v) => v.join('.'))
  .$or(undefined);

type.gzip = type.buffer
  .$parse((v) => Buffer.from(v))
  .$after(zlib.gzipSync);

type.unzipBase64 = type.buffer
  .$parse((v) => Buffer.from(v, 'base64'))
  .$after(zlib.unzipSync)
  .$after(String);

type.toMD5 = type((v) => crypto.createHash('md5').update(v).digest('hex'));

module.exports = type;
