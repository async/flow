import assert from "node:assert/strict";
import { test } from "node:test";
import { defineAsyncSignal as asyncSignal } from "../src/define.js";
import { createFlow, createSignal } from "../src/framework-runtime.js";
import { set } from "../src/helpers.js";

test("async handlers publish one named batch for post-await mutation and returned updates", async () => {
  const changes = [];
  const counter = createFlow({
    store: {
      count: 0,
      phase: "idle"
    },
    on: {
      async later(store, input) {
        await Promise.resolve();
        store.count += input.by;
        return { phase: "done" };
      }
    }
  });

  counter.subscribe((change) => changes.push(change));
  await counter.later({ by: 1 });

  assert.deepEqual(changes, [
    {
      name: "later",
      input: { by: 1 },
      store: {
        count: 1,
        phase: "done"
      }
    }
  ]);
});

test("async handlers publish one named batch when post-await mutation returns undefined", async () => {
  const changes = [];
  const counter = createFlow({
    store: {
      count: 0
    },
    on: {
      async later(store) {
        await Promise.resolve();
        store.count += 2;
      }
    }
  });

  counter.subscribe((change) => changes.push(change));
  await counter.later();

  assert.deepEqual(changes, [
    {
      name: "later",
      input: undefined,
      store: {
        count: 2
      }
    }
  ]);
});

test("concurrent async dispatches keep post-await mutations attributed to their own event", async () => {
  const changes = [];
  const first = deferred();
  const second = deferred();
  const flow = createFlow({
    store: {
      first: false,
      second: false
    },
    on: {
      async markFirst(store, input) {
        await first.promise;
        store.first = input;
      },
      async markSecond(store, input) {
        await second.promise;
        store.second = input;
      }
    }
  });

  flow.subscribe((change) => changes.push(change));
  const firstDispatch = flow.markFirst(true);
  const secondDispatch = flow.markSecond(true);

  second.resolve();
  await secondDispatch;
  first.resolve();
  await firstDispatch;

  assert.deepEqual(changes, [
    {
      name: "markSecond",
      input: true,
      store: {
        first: false,
        second: true
      }
    },
    {
      name: "markFirst",
      input: true,
      store: {
        first: true,
        second: true
      }
    }
  ]);
});

test("async handlers that mutate then reject notify committed state before rejecting", async () => {
  const changes = [];
  const flow = createFlow({
    store: {
      count: 0
    },
    on: {
      async failAfterMutation(store, input) {
        await Promise.resolve();
        store.count = input;
        throw new Error("failed");
      }
    }
  });

  flow.subscribe((change) => changes.push(change));
  await assert.rejects(() => flow.failAfterMutation(3), /failed/);

  assert.deepEqual(changes, [
    {
      name: "failAfterMutation",
      input: 3,
      store: {
        count: 3
      }
    }
  ]);
});

test("destroy is terminal for Flow APIs public refs controllers and subscriptions", () => {
  const flow = createFlow({
    store: {
      count: 0,
      work: asyncSignal(async () => 1)
    },
    on: {
      inc(store) {
        store.count += 1;
      }
    }
  });
  let whole = 0;
  let named = 0;
  let refNamed = 0;

  flow.subscribe(() => {
    whole += 1;
  });
  flow.subscribe("count", () => {
    named += 1;
  });
  flow.refs.count.subscribe(() => {
    refNamed += 1;
  });

  flow.destroy();
  flow.destroy();

  assert.throws(() => flow.inc(), /Flow instance has been destroyed/);
  assert.throws(() => flow.dispatch("inc"), /Flow instance has been destroyed/);
  assert.throws(() => flow.set("count", 1), /Flow instance has been destroyed/);
  assert.throws(() => flow.update("count", (value) => value), /Flow instance has been destroyed/);
  assert.throws(() => flow.restore({ count: 1 }), /Flow instance has been destroyed/);
  assert.throws(() => flow.subscribe(() => {}), /Flow instance has been destroyed/);
  assert.throws(() => flow.subscribe("count", () => {}), /Flow instance has been destroyed/);
  assert.throws(() => {
    flow.count = 1;
  }, /Flow instance has been destroyed/);
  assert.throws(() => {
    flow.store.count = 1;
  }, /Flow instance has been destroyed/);
  assert.throws(() => flow.refs.count.set(1), /Flow instance has been destroyed/);
  assert.throws(() => flow.refs.count.update((value) => value), /Flow instance has been destroyed/);
  assert.throws(() => flow.refs.count.restore(1), /Flow instance has been destroyed/);
  assert.throws(() => {
    flow.refs.count.value = 1;
  }, /Flow instance has been destroyed/);
  assert.throws(() => flow.refs.count.subscribe(() => {}), /Flow instance has been destroyed/);
  assert.throws(() => flow.asyncSignals.work.load(), /Flow instance has been destroyed/);
  assert.throws(() => flow.asyncSignals.work.reload(), /Flow instance has been destroyed/);
  assert.throws(() => flow.asyncSignals.work.cancel(), /Flow instance has been destroyed/);
  assert.throws(() => flow.asyncSignals.work.subscribe(() => {}), /Flow instance has been destroyed/);

  assert.equal(flow.get("count"), 0);
  assert.equal(flow.refs.count.get(), 0);
  assert.deepEqual(flow.snapshot(), {
    count: 0,
    work: {
      value: undefined,
      status: "idle",
      error: undefined,
      version: 0
    }
  });
  assert.deepEqual({ whole, named, refNamed }, { whole: 0, named: 0, refNamed: 0 });
});

test("destroy clears after timers before they dispatch", async () => {
  const flow = createFlow({
    store: {
      count: 0
    },
    on: {
      schedule() {
        this.after(0, "inc");
      },
      inc(store) {
        store.count += 1;
      }
    }
  });

  flow.schedule();
  flow.destroy();
  await delay(10);

  assert.equal(flow.count, 0);
});

test("destroy aborts immediate and lazy async signals without committing stale values", async () => {
  const immediate = createFlow({
    store: {
      work: asyncSignal({ immediate: true }, abortableLoader("immediate"))
    }
  });
  const immediateRun = immediate.refs.work.load();

  await Promise.resolve();
  immediate.destroy();
  await assert.rejects(immediateRun, /immediate aborted/);
  assert.equal(immediate.refs.work.status, "idle");
  assert.equal(immediate.work, undefined);

  const lazy = createFlow({
    store: {
      work: asyncSignal(abortableLoader("lazy"))
    }
  });
  const lazyRun = lazy.refs.work.load();

  await Promise.resolve();
  lazy.destroy();
  await assert.rejects(lazyRun, /lazy aborted/);
  assert.equal(lazy.refs.work.status, "idle");
  assert.equal(lazy.work, undefined);
});

test("immediate async signal loader rejections settle to error without unhandled run failures", async () => {
  const failure = new Error("load failed");
  const flow = createFlow({
    store: {
      work: asyncSignal({ immediate: true }, async () => {
        throw failure;
      })
    }
  });

  await delay(0);

  assert.equal(flow.refs.work.status, "error");
  assert.equal(flow.refs.work.error, failure);
  flow.destroy();
});

test("async signal restore cancels in-flight load before applying hydrated state", async () => {
  const pending = deferred();
  const flow = createFlow({
    store: {
      work: asyncSignal(async () => pending.promise)
    }
  });
  const run = flow.refs.work.load();

  await Promise.resolve();
  flow.refs.work.restore({
    value: "hydrated",
    status: "ready",
    error: undefined,
    version: 10
  });
  pending.resolve("stale");
  await run;

  assert.equal(flow.work, "hydrated");
  assert.equal(flow.refs.work.status, "ready");
  assert.equal(flow.refs.work.version, 10);
});

test("live signal declarations are adopted instead of copied into a split store ref", () => {
  const external = createSignal(0);
  const flow = createFlow({
    store: {
      count: external
    },
    on: {
      bumpExternal: set(external, (store) => store.count + 1)
    }
  });

  flow.bumpExternal();

  assert.equal(external.get(), 1);
  assert.equal(flow.count, 1);
  assert.equal(flow.refs.count.get(), 1);
});

test("handler receiver after validates target names before scheduling", () => {
  const flow = createFlow({
    store: {},
    on: {
      scheduleMissing() {
        this.after(0, "missing");
      }
    }
  });

  assert.throws(() => flow.scheduleMissing(), /Unknown Flow handler "missing"/);
});

test("handler receiver after contains timer-driven async dispatch failures", async () => {
  const flow = createFlow({
    store: {
      count: 0
    },
    on: {
      schedule() {
        this.after(0, "failLater", 3);
      },
      async failLater(store, input) {
        await Promise.resolve();
        store.count = input;
        throw new Error("timer failure");
      }
    }
  });

  flow.schedule();
  await delay(10);

  assert.equal(flow.count, 3);
});

function abortableLoader(label) {
  return function loadAbortable() {
    return new Promise((resolve, reject) => {
      this.signal.addEventListener("abort", () => {
        reject(new Error(`${label} aborted`));
      }, { once: true });
      setTimeout(() => resolve(`${label} done`), 50);
    });
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
