import assert from "node:assert/strict";
import test from "node:test";
import { isPromiseLike, run } from "@async/flow/run";

test("run(fn) and run(array) return functions", () => {
  assert.equal(typeof run(() => 1), "function");
  assert.equal(typeof run([() => 1]), "function");
});

test("all-sync steps return synchronously with the last non-undefined result", () => {
  const handler = run([
    () => 1,
    () => undefined,
    () => 2
  ]);

  const result = handler({});

  assert.equal(isPromiseLike(result), false);
  assert.equal(result, 2);
});

test("async steps switch remaining execution to a promise-like result", async () => {
  const order = [];
  const handler = run([
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
      run([
        () => {
          throw new Error("sync");
        }
      ])({}),
    /sync/
  );

  await assert.rejects(
    run([
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
    run([
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
