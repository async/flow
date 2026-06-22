import assert from "node:assert/strict";
import test from "node:test";
import { flow, guard, onError, set, status, transition } from "@async/flow";
import { compose, isPromiseLike, parallel, remember } from "@async/flow/compose";

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

test("parallel array branches share receiver input store and previous without replacing previous", () => {
  const seen = [];
  const receiver = { label: "checkout" };
  const handler = compose([
    () => "seed",
    parallel([
      function first(store, input, previous) {
        seen.push([this.label, store.count, input.by, previous]);
      },
      function second(store, input, previous) {
        store.count += input.by;
        seen.push([this.label, store.count, input.by, previous]);
        return "ignored";
      }
    ]),
    (_store, _input, previous) => previous
  ]);

  assert.equal(handler.call(receiver, { count: 1 }, { by: 2 }), "seed");
  assert.deepEqual(seen, [
    ["checkout", 1, 2, "seed"],
    ["checkout", 3, 2, "seed"]
  ]);
});

test("parallel keyed async branches all start before awaiting and resolve to undefined", async () => {
  const order = [];
  let resolveUser;
  let resolveCart;
  const user = new Promise((resolve) => {
    resolveUser = resolve;
  });
  const cart = new Promise((resolve) => {
    resolveCart = resolve;
  });
  const step = parallel({
    user() {
      order.push("user:start");
      return user.then(() => order.push("user:done"));
    },
    cart() {
      order.push("cart:start");
      return cart.then(() => order.push("cart:done"));
    }
  });

  const result = step({}, {});

  assert.equal(isPromiseLike(result), true);
  assert.deepEqual(order, ["user:start", "cart:start"]);

  resolveCart();
  resolveUser();
  assert.equal(await result, undefined);
  assert.deepEqual(order.sort(), ["cart:done", "cart:start", "user:done", "user:start"].sort());
});

test("parallel validates branches and works with onError", async () => {
  assert.throws(() => parallel([]), /at least one branch/);
  assert.throws(() => parallel({ user: () => {}, cart: null }), /branch functions/);

  const checkout = flow({
    store: {
      error: null
    },
    on: {
      refresh: onError(
        (error) => ({ error: error.message }),
        parallel([
          () => Promise.resolve(),
          async () => {
            throw new Error("refresh failed");
          }
        ])
      )
    }
  });

  await checkout.refresh();
  assert.equal(checkout.store.error, "refresh failed");
});

test("remember captures changed sources after successful scoped work", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"]),
      previousStep: null
    },
    on: {
      next: remember(["step", "previousStep"], [
        transition("step", {
          shipping: "payment",
          payment: "review"
        })
      ])
    }
  });

  checkout.next();

  assert.equal(checkout.store.step, "payment");
  assert.equal(checkout.store.previousStep, "shipping");
});

test("remember skips target writes for unchanged sources", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment"]),
      previousStep: "keep",
      touched: false
    },
    on: {
      touch: remember(["step", "previousStep"], [
        set("touched", true)
      ])
    }
  });

  checkout.touch();

  assert.equal(checkout.store.step, "shipping");
  assert.equal(checkout.store.previousStep, "keep");
  assert.equal(checkout.store.touched, true);
});

test("remember supports multiple mappings and validates mapping input", () => {
  assert.throws(() => remember("step", () => undefined), /requires a memory mapping/);
  assert.throws(() => remember(["step"], () => undefined), /mappings must/);
  assert.throws(() => remember([], () => undefined), /requires a memory mapping/);
  assert.throws(() => remember(["step", "step"], () => undefined), /must differ/);
  assert.throws(
    () => remember([["step", "previousStep"], ["step", "otherPreviousStep"]], () => undefined),
    /duplicate source/
  );
  assert.throws(
    () => remember([["step", "previousStep"], ["mode", "previousStep"]], () => undefined),
    /duplicate target/
  );
  assert.throws(() => remember(["step", "previousStep"], []), /non-empty array/);

  const checkout = flow({
    store: {
      step: "shipping",
      previousStep: null,
      mode: "viewing",
      previousMode: null
    },
    on: {
      edit: remember([
        ["step", "previousStep"],
        ["mode", "previousMode"]
      ], [
        set("step", "payment"),
        set("mode", "editing")
      ])
    }
  });

  checkout.edit();

  assert.equal(checkout.store.previousStep, "shipping");
  assert.equal(checkout.store.previousMode, "viewing");
});

test("remember preserves receiver input inbound previous and wrapped previous progression", () => {
  const seen = [];
  const receiver = { label: "receiver" };
  const handler = compose([
    () => "inbound",
    remember(["count", "previousCount"], [
      function first(store, input, previous) {
        seen.push([this.label, input.next, previous]);
        store.count = input.next;
        return `${previous}:first`;
      },
      function second(_store, _input, previous) {
        return `${previous}:second`;
      }
    ])
  ]);
  const store = {
    count: 1,
    previousCount: null
  };

  assert.equal(handler.call(receiver, store, { next: 2 }), "inbound:first:second");
  assert.deepEqual(seen, [["receiver", 2, "inbound"]]);
  assert.deepEqual(store, {
    count: 2,
    previousCount: 1
  });
});

test("remember does not write targets when scoped work throws or rejects", async () => {
  const syncFailure = flow({
    store: {
      count: 0,
      previousCount: null
    },
    on: {
      fail: remember(["count", "previousCount"], [
        (store) => {
          store.count = 1;
          throw new Error("sync failed");
        }
      ])
    }
  });

  assert.throws(() => syncFailure.fail(), /sync failed/);
  assert.equal(syncFailure.store.count, 1);
  assert.equal(syncFailure.store.previousCount, null);

  const asyncFailure = flow({
    store: {
      count: 0,
      previousCount: null
    },
    on: {
      fail: remember(["count", "previousCount"], [
        (store) => {
          store.count = 1;
        },
        async () => {
          throw new Error("async failed");
        }
      ])
    }
  });

  await assert.rejects(asyncFailure.fail(), /async failed/);
  assert.equal(asyncFailure.store.count, 1);
  assert.equal(asyncFailure.store.previousCount, null);
});

test("remember writes after async success and composes with guard parallel and onError", async () => {
  const checkout = flow({
    store: {
      phase: status("idle", ["idle", "saving", "saved", "error"]),
      previousPhase: null,
      canSave: true,
      userLoaded: false,
      cartLoaded: false,
      error: null
    },
    on: {
      save: onError(
        (error) => ({
          phase: "error",
          error: error.message
        }),
        remember(["phase", "previousPhase"], [
          guard(
            (store) => store.canSave,
            set("phase", "saving")
          ),
          parallel([
            async (store) => {
              store.userLoaded = true;
            },
            async (store) => {
              store.cartLoaded = true;
            }
          ]),
          set("phase", "saved")
        ])
      )
    }
  });

  assert.equal(await checkout.save(), undefined);
  assert.equal(checkout.store.phase, "saved");
  assert.equal(checkout.store.previousPhase, "idle");
  assert.equal(checkout.store.userLoaded, true);
  assert.equal(checkout.store.cartLoaded, true);
  assert.equal(checkout.store.error, null);
});
