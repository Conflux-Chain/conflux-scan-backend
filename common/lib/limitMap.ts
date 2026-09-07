interface LimitMapOptions {
  limit?: number;
  qps?: number;
  deltaMs?: number;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function limitMap<R = any>(
  array: any[],
  func: (value: any, index: number, array: any[]) => Promise<R> | R,
  {limit = Infinity, qps = Infinity, deltaMs = 0}: LimitMapOptions = {},
): Promise<R[]> {
  let index = 0;
  const emitTimeArray: number[] = [];

  let error: unknown;
  const results: R[] = [];

  async function worker() {
    while (!error && index < array.length) {
      const currentIndex = index;
      index += 1;

      const now = Date.now();
      const minLimitTime = emitTimeArray[emitTimeArray.length - qps] + 1000 || -Infinity;
      const minDelayTime = emitTimeArray[emitTimeArray.length - 1] + deltaMs || -Infinity;
      const emitTime = Math.max(minLimitTime, minDelayTime, now);

      emitTimeArray.push(emitTime);
      await sleepMs(emitTime - now);

      results[currentIndex] = await func(array[currentIndex], currentIndex, array);
    }
  }

  const workers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < Math.min(limit, array.length); workerIndex += 1) {
    workers.push(worker());
  }

  try {
    await Promise.all(workers);
  } catch (e) {
    error = e;
    throw e;
  }

  return results;
}

const sleepMsFunction = sleepMs;

namespace limitMap {
  export const sleepMs = sleepMsFunction;
}

export = limitMap;
