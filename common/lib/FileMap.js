const assert = require('assert');
const pathLib = require('path');
const { promises: fs } = require('fs');
const LockSet = require('./LockSet');

class FileMap {
  constructor({ location }) {
    assert(typeof location === 'string', `location can not be empty, got "${location}"`);
    this.location = location;
    this.lockSet = new LockSet();
  }

  async get(filename, expires = Infinity) {
    const path = pathLib.resolve(this.location, filename);
    const status = await fs.stat(path).catch(() => undefined);
    if (!status || !(status.ctimeMs + expires > Date.now())) {
      return undefined;
    }
    return fs.readFile(path).catch(() => undefined);
  }

  async set(filename, data) {
    const path = pathLib.resolve(this.location, filename);
    const { dir } = pathLib.parse(path);
    if (!await fs.access(dir).then(() => true).catch(() => false)) {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(path, data).catch(() => undefined);
  }

  // TODO delete

  async clear() {
    return fs.rmdir(this.location, { recursive: true });
  }

  async cache(filename, func, { expires } = {}) {
    return this.lockSet.lock(filename, async () => {
      let value = await this.get(filename, expires);
      let reload = false;

      if (value === undefined) {
        value = await func();
        reload = true;
      }

      if (reload) {
        await this.set(filename, value);
      }

      return value;
    });
  }
}

module.exports = FileMap;
