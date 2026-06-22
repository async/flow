import assert from "node:assert/strict";
import test from "node:test";
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
