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
module.exports = { uniquePromise, withoutCfxTransferType };
