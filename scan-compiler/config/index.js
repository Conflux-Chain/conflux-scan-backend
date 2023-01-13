module.exports = {
  SERVICE: 'compiler',
  port: 8884,
  machine: '',

  fileMap: {
    location: '/cache',
  },

  requestLogger: {
    enable: true,
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
