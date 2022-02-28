const requestIp = require('request-ip');

async function countRequestByIp(ctx, next) {
  const {
    app: { prometheus },
  } = ctx;

  const ip = requestIp.getClientIp(ctx.request);
  prometheus.addRequest(ip);

  return next();
}

module.exports = countRequestByIp;
