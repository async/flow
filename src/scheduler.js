let currentDefaultScheduler = createDefaultScheduler();

export let defaultScheduler = currentDefaultScheduler;

export function createDefaultScheduler() {
  let depth = 0;
  let queue = [];

  function drain() {
    while (queue.length > 0) {
      const jobs = queue;
      queue = [];

      for (const job of jobs) {
        job();
      }
    }
  }

  return {
    batch(fn) {
      depth += 1;

      try {
        return fn();
      } finally {
        depth -= 1;

        if (depth === 0) {
          drain();
        }
      }
    },

    enqueue(fn) {
      if (depth > 0) {
        queue.push(fn);
        return;
      }

      fn();
    },

    async flush() {
      drain();
    }
  };
}

export function getDefaultScheduler() {
  return currentDefaultScheduler;
}

export function setDefaultScheduler(scheduler) {
  validateScheduler(scheduler);
  currentDefaultScheduler = scheduler;
  defaultScheduler = scheduler;
  return currentDefaultScheduler;
}

export function resetDefaultScheduler() {
  currentDefaultScheduler = createDefaultScheduler();
  defaultScheduler = currentDefaultScheduler;
  return currentDefaultScheduler;
}

export function resolveScheduler(options = {}) {
  const scheduler = options.scheduler ?? currentDefaultScheduler;
  validateScheduler(scheduler);
  return scheduler;
}

export function validateScheduler(scheduler) {
  if (!scheduler || typeof scheduler.batch !== "function") {
    throw new TypeError("Flow scheduler requires a batch(fn) function.");
  }

  if (scheduler.enqueue !== undefined && typeof scheduler.enqueue !== "function") {
    throw new TypeError("Flow scheduler enqueue must be a function when provided.");
  }

  if (scheduler.flush !== undefined && typeof scheduler.flush !== "function") {
    throw new TypeError("Flow scheduler flush must be a function when provided.");
  }
}
