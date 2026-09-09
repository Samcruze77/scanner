const env = require("../config/env");

class ConversionQueue {
  constructor(concurrency = env.queueConcurrency) {
    this.concurrency = concurrency;
    this.active = 0;
    this.queue = [];
  }

  enqueue(taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject });
      this.runNext();
    });
  }

  runNext() {
    if (this.active >= this.concurrency || !this.queue.length) return;

    const { taskFn, resolve, reject } = this.queue.shift();
    this.active += 1;

    Promise.resolve()
      .then(() => taskFn())
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.active -= 1;
        this.runNext();
      });
  }
}

module.exports = new ConversionQueue();
