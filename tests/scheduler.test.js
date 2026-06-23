import assert from "node:assert/strict";
import test from "node:test";
import {
  computed,
  createDefaultScheduler,
  createFlow,
  createSignal,
  defaultScheduler,
  flow,
  getDefaultScheduler,
  resetDefaultScheduler,
  setDefaultScheduler
} from "@async/flow";

test("standalone signal refs work without a provided scheduler", () => {
  const signal = createSignal(0);
  const values = [];

  signal.subscribe((value) => values.push(value));
  signal.set(1);

  assert.deepEqual(values, [1]);
});

test("default scheduler batches and coalesces repeated writes", () => {
  const scheduler = createDefaultScheduler();
  const signal = createSignal(0, { scheduler });
  const values = [];

  signal.subscribe((value) => values.push(value));

  scheduler.batch(() => {
    signal.set(1);
    signal.set(2);
  });

  assert.deepEqual(values, [2]);
});

test("top-level APIs use the module-owned default scheduler for future creations", async () => {
  const jobs = [];
  const queuedScheduler = {
    batch(fn) {
      return fn();
    },
    enqueue(fn) {
      jobs.push(fn);
    },
    async flush() {
      while (jobs.length) {
        jobs.shift()();
      }
    }
  };

  setDefaultScheduler(queuedScheduler);

  try {
    assert.equal(defaultScheduler, queuedScheduler);
    assert.equal(getDefaultScheduler(), queuedScheduler);

    const signal = createSignal(0);
    const values = [];
    signal.subscribe((value) => values.push(value));
    signal.set(1);

    assert.deepEqual(values, []);
    await queuedScheduler.flush();
    assert.deepEqual(values, [1]);
  } finally {
    resetDefaultScheduler();
  }
});

test("resetDefaultScheduler restores the built-in default scheduler", () => {
  const custom = {
    batch(fn) {
      return fn();
    }
  };

  setDefaultScheduler(custom);
  assert.equal(getDefaultScheduler(), custom);
  const restored = resetDefaultScheduler();

  assert.equal(getDefaultScheduler(), restored);
  assert.equal(defaultScheduler, restored);
});

test("explicit scheduler options override the default scheduler", async () => {
  const defaultJobs = [];
  const explicitJobs = [];
  const customDefault = {
    batch(fn) {
      return fn();
    },
    enqueue(fn) {
      defaultJobs.push(fn);
    }
  };
  const explicit = {
    batch(fn) {
      return fn();
    },
    enqueue(fn) {
      explicitJobs.push(fn);
    },
    async flush() {
      while (explicitJobs.length) {
        explicitJobs.shift()();
      }
    }
  };

  setDefaultScheduler(customDefault);

  try {
    const signal = createSignal(0, { scheduler: explicit });
    const values = [];
    signal.subscribe((value) => values.push(value));
    signal.set(1);

    assert.equal(defaultJobs.length, 0);
    assert.equal(explicitJobs.length, 1);
    await explicit.flush();
    assert.deepEqual(values, [1]);
  } finally {
    resetDefaultScheduler();
  }
});

test("createFlow passes the scheduler to owned primitives and batches handlers", () => {
  const calls = [];
  const scheduler = {
    batch(fn) {
      calls.push("batch");
      return fn();
    },
    enqueue(fn) {
      calls.push("enqueue");
      fn();
    }
  };
  const cart = createFlow(
    {
      store: {
        items: [],
        count: computed(function () {
          return this.store.items.length;
        })
      },
      on: {
        add: (store, input) => ({
          items: [...store.items, input.item]
        })
      }
    },
    { scheduler }
  );
  const changes = [];

  cart.subscribe((change) => changes.push(change));
  cart.add({ item: { id: "sku_123" } });

  assert.deepEqual(changes, [
    {
      name: "add",
      input: { item: { id: "sku_123" } },
      store: {
        count: 1,
        items: [{ id: "sku_123" }]
      }
    }
  ]);
  assert.deepEqual(calls, ["batch", "enqueue", "enqueue"]);
});

test("top-level flow uses the current default scheduler at creation time", async () => {
  const jobs = [];
  const queuedScheduler = {
    batch(fn) {
      return fn();
    },
    enqueue(fn) {
      jobs.push(fn);
    },
    async flush() {
      while (jobs.length) {
        jobs.shift()();
      }
    }
  };

  setDefaultScheduler(queuedScheduler);

  try {
    const counter = flow({
      store: {
        count: 0
      },
      on: {
        increment: (store) => ({ count: store.count + 1 })
      }
    });
    const changes = [];
    counter.subscribe((change) => changes.push(change));

    counter.increment();
    assert.deepEqual(changes, []);
    await queuedScheduler.flush();
    assert.deepEqual(changes, [{ store: { count: 1 } }]);
  } finally {
    resetDefaultScheduler();
  }
});
