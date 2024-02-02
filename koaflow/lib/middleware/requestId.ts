const lodash = require('lodash');

export async function requestId(ctx, next) {
  const date = new Date();
  ctx.requestId = `${date.toISOString()}${lodash.random(100000, 999999)}`;
  ctx.set('Request-Id', ctx.requestId);
  await next();
}

// module.exports = requestId;
