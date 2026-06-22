import assert from "node:assert/strict";
import test from "node:test";
import {
  computed,
  defineFlow,
  flow,
  guard,
  resource,
  signal,
  status,
  STATUS,
  transition
} from "@async/flow";
import {
  createComputed,
  createFlow,
  createSignal,
  createStatus,
  createStore
} from "@async/flow/runtime";

test("createSignal exposes get value set update subscribe and snapshot", () => {
  const count = createSignal(0);
  const values = [];
  const stop = count.subscribe((value) => values.push(value));

  assert.equal(count.get(), 0);
  assert.equal(count.value, 0);
  assert.equal(count.set(1), 1);
  assert.equal(count.value, 1);
  assert.equal(count.update((value) => value + 1), 2);
  assert.deepEqual(values, [1, 2]);
  assert.equal(count.snapshot(), 2);

  stop();
  count.set(3);
  assert.deepEqual(values, [1, 2]);
});

test("createStatus validates allowed values and carries the status brand", () => {
  const phase = createStatus("idle", ["idle", "loading"]);

  assert.equal(phase[STATUS], true);
  phase.set("loading");
  assert.equal(phase.get(), "loading");
  assert.throws(() => phase.set("done"), /Invalid status value/);
});

test("createComputed tracks signal dependencies and notifies when value changes", () => {
  const count = createSignal(1);
  const doubled = createComputed(() => count.value * 2);
  const values = [];

  doubled.subscribe((value) => values.push(value));

  assert.equal(doubled.get(), 2);
  count.set(2);
  assert.equal(doubled.value, 4);
  assert.deepEqual(values, [4]);
});

test("createStore normalizes values and exposes refs behind a store proxy", () => {
  const cart = createStore({
    items: [],
    selectedId: signal(null),
    count: (store) => store.items.length,
    isEmpty: computed((store) => store.count === 0),
    phase: status("idle", ["idle", "ready"])
  });

  cart.store.items = [{ id: "sku_123" }];
  cart.store.selectedId = "sku_123";
  cart.store.phase = "ready";

  assert.deepEqual(cart.store.items, [{ id: "sku_123" }]);
  assert.equal(cart.store.count, 1);
  assert.equal(cart.store.isEmpty, false);
  assert.equal(cart.refs.selectedId.get(), "sku_123");
  assert.equal(cart.refs.phase[STATUS], true);
  assert.throws(() => {
    cart.store.count = 10;
  }, /read-only/);
});

test("flow creates store and separate refs", () => {
  const cart = flow({
    store: {
      items: [],
      selectedId: signal(null),
      count: (store) => store.items.length,
      isEmpty: computed((store) => store.count === 0)
    },
    on: {
      add(store, input) {
        store.items = [...store.items, input.item];
      },
      select(store, input) {
        this.refs.selectedId.set(input.id);
      },
      clear: () => ({ items: [] })
    }
  });

  cart.add({ item: { id: "sku_123" } });
  assert.deepEqual(cart.store.items, [{ id: "sku_123" }]);
  assert.equal(cart.store.count, 1);
  assert.equal(cart.store.isEmpty, false);
  assert.deepEqual(cart.refs.items.value, [{ id: "sku_123" }]);

  cart.select({ id: "sku_123" });
  assert.equal(cart.refs.selectedId.get(), "sku_123");

  cart.clear();
  assert.deepEqual(cart.snapshot(), {
    items: [],
    selectedId: "sku_123",
    count: 0,
    isEmpty: true
  });
});

test("flow instances created from one definition do not share live state", () => {
  const definition = defineFlow({
    store: {
      count: 0
    },
    on: {
      increment(store) {
        return { count: store.count + 1 };
      }
    }
  });

  const first = createFlow(definition);
  const second = createFlow(definition);

  first.increment();
  assert.equal(first.store.count, 1);
  assert.equal(second.store.count, 0);
});

test("plain object store declarations are invalid unless wrapped in signal", () => {
  assert.throws(
    () =>
      flow({
        store: {
          product: {
            name: "Keyboard"
          }
        }
      }),
    /Nested store objects are not supported/
  );

  const product = flow({
    store: {
      product: signal({ name: "Keyboard" })
    }
  });

  assert.deepEqual(product.store.product, { name: "Keyboard" });
});

test("handler arrays are invalid and returned objects update writable store values", () => {
  assert.throws(
    () =>
      flow({
        on: {
          submit: []
        }
      }),
    /Use compose\(\[\.\.\.\]\)/
  );

  const counter = flow({
    store: {
      count: 0,
      doubled: (store) => store.count * 2
    },
    on: {
      increment: (store) => ({ count: store.count + 1 }),
      typo: () => ({ coutn: 1 }),
      writeComputed: () => ({ doubled: 10 })
    }
  });

  assert.deepEqual(counter.increment(), { count: 1 });
  assert.equal(counter.store.doubled, 2);
  assert.throws(() => counter.typo(), /Unknown Flow store value "coutn"/);
  assert.throws(() => counter.writeComputed(), /read-only/);
});

test("whole-flow subscribers receive batched change records", () => {
  const changes = [];
  const checkout = flow({
    store: {
      loading: false,
      orderId: null
    },
    on: {
      submit: (store, input) => ({
        loading: true,
        orderId: input.orderId
      })
    }
  });

  checkout.subscribe((change) => changes.push(change));
  checkout.submit({ orderId: "ord_123" });

  assert.deepEqual(changes, [
    {
      name: "submit",
      input: { orderId: "ord_123" },
      store: {
        loading: true,
        orderId: "ord_123"
      }
    }
  ]);
});

test("restore updates writable refs and recomputes computed refs", () => {
  const cart = flow({
    store: {
      items: [],
      count: (store) => store.items.length
    }
  });

  cart.restore({ items: [{ id: "sku_123" }], count: 99 });

  assert.equal(cart.store.count, 1);
  assert.deepEqual(cart.snapshot(), {
    items: [{ id: "sku_123" }],
    count: 1
  });
});

test("flow describe returns fresh public store resource handler transition and guard metadata", () => {
  const checkout = flow({
    store: {
      step: status("shipping", ["shipping", "payment", "review"]),
      settings: signal({ currency: "USD" }),
      count: 0,
      doubled: (store) => store.count * 2,
      user: resource(async () => ({ id: "user_123" }))
    },
    on: {
      next: transition("step", {
        from: "shipping",
        to: "payment",
        when: (store) => store.count >= 0,
        reason: "cannot_continue",
        label: "Continue"
      }),
      submit: guard(
        (store) => store.step === "review",
        () => undefined,
        {
          reason: "cannot_submit",
          label: "Submit"
        }
      )
    }
  });
  const description = checkout.describe();

  assert.deepEqual(description.handlers, ["next", "submit"]);
  assert.deepEqual(description.store.step, {
    kind: "status",
    writable: true,
    value: "shipping",
    allowed: ["shipping", "payment", "review"]
  });
  assert.equal(description.store.doubled.kind, "computed");
  assert.equal(description.store.doubled.writable, false);
  assert.equal(description.store.doubled.value, 0);
  assert.deepEqual(description.resources.user, {
    kind: "resource",
    status: "idle",
    loading: false,
    ready: false,
    version: 0
  });
  assert.deepEqual(description.transitions.next, {
    status: "step",
    rules: [
      {
        conditional: true,
        reason: "cannot_continue",
        label: "Continue",
        from: "shipping",
        to: "payment"
      }
    ]
  });
  assert.deepEqual(description.guards.submit, {
    conditional: true,
    reason: "cannot_submit",
    label: "Submit"
  });
  assert.equal(Object.hasOwn(description.transitions.next.rules[0], "when"), false);
  assert.equal(Object.hasOwn(description.guards.submit, "predicate"), false);

  description.store.settings.value.currency = "EUR";
  description.store.step.allowed.push("done");
  assert.equal(checkout.store.settings.currency, "USD");
  assert.deepEqual(checkout.describe().store.step.allowed, ["shipping", "payment", "review"]);
});

test("handlers receive store input and receiver capabilities", () => {
  const events = [];
  const counter = flow(
    {
      context() {
        return {
          logger: events
        };
      }
    },
    {
      store: {
        count: 0
      },
      on: {
        increment(store, input) {
          store.count += input.by;
          this.logger.push(["increment", store.count]);
          return this.dispatch("read");
        },
        read(store) {
          return store.count;
        }
      }
    }
  );

  assert.equal(counter.dispatch("increment", { by: 2 }), 2);
  assert.deepEqual(events, [["increment", 2]]);
  assert.equal(counter.handlers.read(), 2);
  assert.equal(Object.hasOwn(counter, "run"), false);
  assert.equal(counter.run, undefined);
  assert.throws(() => counter.dispatch("missing"), /Unknown Flow handler/);
});

test("async dispatch returns promise-like handler results", async () => {
  const checkout = flow({
    store: {
      submitted: false
    },
    on: {
      async submit(store, input) {
        store.submitted = true;
        return input.orderId;
      }
    }
  });

  const result = checkout.dispatch("submit", { orderId: "ord_123" });

  assert.equal(typeof result.then, "function");
  assert.equal(await result, "ord_123");
  assert.equal(checkout.store.submitted, true);
});

test("old runner subpath is not public", async () => {
  await assert.rejects(
    import("@async/flow/run"),
    /Package subpath|Cannot find/
  );
});

test("arrow handlers work when they only need store and input", () => {
  const counter = flow({
    store: {
      count: 0
    },
    on: {
      increment: (store, input) => ({ count: store.count + input.by })
    }
  });

  counter.increment({ by: 3 });
  assert.equal(counter.store.count, 3);
});
