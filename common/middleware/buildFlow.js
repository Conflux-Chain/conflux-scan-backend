function buildFlow(func) {
  let flow;
  return async function (options) {
    flow = flow || func(this.app);
    return flow.call(this, options);
  };
}

module.exports = buildFlow;
