module.exports = {
  SERVICE: 'api',
  port: 8895,
  machine: '',
  password: 'password',

  updateHolderDelta: 60 * 60 * 1000, // in ms
  updateQuoteDelta: 60 * 60 * 1000, // in ms

  custodianAddress: '0x890e3feac4a2c33d7594bc5be62e7970ef5481e0',
  announcementAddress: '0x81bbe80b1282387e19d7e1a57476869081c7d965', // prod & stag
  announcer: '0x187f1d870c7da2a5790c16ab6ee02279e0401c95', // or PrivateKey
  marketCapToken: 'a076084d-e74b-497d-8a34-44a0b095a0e9',

  conflux: {
    url: 'http://main.confluxrpc.org',
  },

  // sync: {
  //   url: 'http://127.0.0.1:8886',
  //   proxy: {
  //     'compile|decompile|verify|listVersion': 'http://127.0.0.1:8884',
  //     '.*(EventLog|Announce).*': 'http://127.0.0.1:8887',
  //     '.*(ERC20|ERC721|ERC777|ERC1155).*': 'http://127.0.0.1:8888',
  //   },
  // },

  sync: {
    url: 'http://127.0.0.1:8886',
    proxy: {
      'compile|decompile|verify|listVersion': 'http://127.0.0.1:8884',
    },
  },

  requestLogger: {
    enable: false,
    level: 'info',
    format: 'json',
    request: { method: true, url: true, query: true, header: true },
    response: { status: true, message: true, duration: true },
  },


  dingTalk: {
    accessToken: '',
    secret: '',
  },
};
