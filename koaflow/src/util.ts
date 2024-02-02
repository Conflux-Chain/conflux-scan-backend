export function composeFlow([flow = () => undefined, ...restFlow]) {
  const nextFlow = restFlow.length ? composeFlow(restFlow) : v => v;

  return async function (arg) {
    let callNext = true;

    const next = (options) => {
      callNext = false;
      return nextFlow.call(this, options);
    };

    const end = (data) => {
      callNext = false;
      return data;
    };

    let ret = await flow.call(this, arg, next, end);
    if (callNext) {
      ret = await nextFlow.call(this, ret);
    }
    return ret;
  };
}
