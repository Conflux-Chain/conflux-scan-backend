module.exports = {
  SERVICE: 'compiler',
  port: 8884,
  machine: '',

  fileMap: {
    location: '/cache',
  },

  requestLogger: {
    level: 'info',
    format: 'object',
    request: { method: true, url: true, query: true, header: true },
    response: { status: true, message: true, duration: true },
  },

  // level: [trace, debug, info, warn, error, fatal]
  logger: {
    tags: { name: 'compiler', nonce: Date.now() },
    streams: [
      { type: 'daily', path: '/log/info.log', level: 'info', days: 10 },
      { type: 'daily', path: '/log/error.log', level: 'warn', days: 30 },
    ],
  },

  dingTalk: {
    accessToken: '',
    secret: '',
  },
};
