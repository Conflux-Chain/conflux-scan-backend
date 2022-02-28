class LockSet extends Set {
  async lock(key, func, { delay = 0 } = {}) {
    while (this.has(key)) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      this.add(key);
      return await func();
    } finally {
      this.delete(key);
    }
  }
}

module.exports = LockSet;
