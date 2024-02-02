const crypto = require('crypto');
const zlib = require('zlib');
const {type} = require('../koaflow/lib/type');
const { format } = require('js-conflux-sdk');

type.unsigned = type.integer.$validate((v) => v >= 0);
type.hex40 = type.string.$validate((v) => /^0x[0-9a-f]{40}$/.test(v)).$parse((v) => v.toLowerCase());
type.hex64 = type.string.$validate((v) => /^0x[0-9a-f]{64}$/.test(v)).$parse((v) => v.toLowerCase());
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

type.config = type({
  port: type.uint.$default(process.env.PORT),
  preload: type.uint.$default(0).$default(process.env.PRELOAD),
  syncBlock: type.uint.$default(0).$default(process.env.SYNC_BlOCK),
  syncTransaction: type.uint.$default(0).$default(process.env.SYNC_TRANSACTION),
  syncContract: type.uint.$default(0).$default(process.env.SYNC_CONTRACT),
  syncEventLog: type.uint.$default(0).$default(process.env.SYNC_EVENT_LOG),
  syncAnnounce: type.uint.$default(0).$default(process.env.SYNC_ANNOUNCE),
  syncERC20: type.uint.$default(0).$default(process.env.SYNC_ERC20),
  syncERC721: type.uint.$default(0).$default(process.env.SYNC_ERC721),
  syncERC777: type.uint.$default(0).$default(process.env.SYNC_ERC777),
  syncERC1155: type.uint.$default(0).$default(process.env.SYNC_ERC1155),
  syncCFX: type.uint.$default(0).$default(process.env.SYNC_CFX),
}, { strict: true });

module.exports = type;
