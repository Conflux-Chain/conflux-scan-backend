class KeyCounter extends Map {
  get(key) {
    return super.get(key) || 0;
  }

  inc(key) {
    const count = this.get(key) + 1;
    this.set(key, count);
    return count;
  }

  dec(key) {
    const count = this.get(key) - 1;
    if (count > 0) {
      this.set(key, count);
    } else {
      this.delete(key);
    }
    return count;
  }
}

module.exports = KeyCounter;
