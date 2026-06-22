import assert from "node:assert/strict";
import test from "node:test";
import { flow, set } from "@async/flow";
import { compose, isPromiseLike } from "@async/flow/compose";

test("compose(fn) and compose(array) return functions", () => {
  assert.equal(typeof compose(() => 1), "function");
  assert.equal(typeof compose([() => 1]), "function");
});

test("all-sync steps return synchronously with the last non-undefined result", () => {
  const handler = compose([
    () => 1,
    () => undefined,
    () => 2
  ]);

  const result = handler({});

  assert.equal(isPromiseLike(result), false);
  assert.equal(result, 2);
});

test("steps receive stable input and previous result", () => {
  const seen = [];
  const handler = compose([
    (store, input, previous) => {
      seen.push([input, previous]);
      return store.count + input.by;
    },
    (_store, input, previous) => {
      seen.push([input, previous]);
      return previous * 2;
    }
  ]);

  assert.equal(handler({ count: 2 }, { by: 3 }), 10);
  assert.deepEqual(seen, [
    [{ by: 3 }, undefined],
    [{ by: 3 }, 5]
  ]);
});

test("compose preserves the receiver for every step", () => {
  const receiver = { seen: [] };
  const handler = compose([
    function first() {
      this.seen.push("first");
      return 1;
    },
    function second(_store, _input, previous) {
      this.seen.push(["second", previous]);
    }
  ]);

  handler.call(receiver, {});

  assert.deepEqual(receiver.seen, ["first", ["second", 1]]);
});

test("async steps switch remaining execution to a promise-like result", async () => {
  const order = [];
  const handler = compose([
    () => {
      order.push("first");
      return 1;
    },
    async () => {
      order.push("second");
      return 2;
    },
    () => {
      order.push("third");
      return 3;
    }
  ]);

  const result = handler({});

  assert.equal(isPromiseLike(result), true);
  assert.equal(await result, 3);
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("Flow compose continuations resume in a fresh batched segment after async boundaries", async () => {
  const changes = [];
  const checkout = flow({
    store: {
      loading: false,
      orderId: null,
      complete: false
    },
    on: {
      submit: compose([
        set("loading", true),
        async (_store, input) => input.orderId,
        (store, _input, orderId) => {
          store.orderId = orderId;
        },
        (store) => {
          store.complete = true;
        }
      ])
    }
  });

  checkout.subscribe((change) => changes.push(change));
  const pending = checkout.dispatch("submit", { orderId: "ord_123" });

  assert.deepEqual(changes, [
    {
      name: "submit",
      input: { orderId: "ord_123" },
      store: {
        loading: true
      }
    }
  ]);

  await pending;

  assert.deepEqual(changes, [
    {
      name: "submit",
      input: { orderId: "ord_123" },
      store: {
        loading: true
      }
    },
    {
      name: "submit",
      input: { orderId: "ord_123" },
      store: {
        orderId: "ord_123",
        complete: true
      }
    }
  ]);
});

test("sync errors throw before an async boundary and reject after one", async () => {
  assert.throws(
    () =>
      compose([
        () => {
          throw new Error("sync");
        }
      ])({}),
    /sync/
  );

  await assert.rejects(
    compose([
      async () => 1,
      () => {
        throw new Error("late");
      }
    ])({}),
    /late/
  );
});

test("async rejections reject", async () => {
  await assert.rejects(
    compose([
      async () => {
        throw new Error("async");
      }
    ])({}),
    /async/
  );
});

test("isPromiseLike detects thenables only", () => {
  assert.equal(isPromiseLike({ then() {} }), true);
  assert.equal(isPromiseLike(Promise.resolve()), true);
  assert.equal(isPromiseLike(null), false);
  assert.equal(isPromiseLike({}), false);
  assert.equal(isPromiseLike(1), false);
});
