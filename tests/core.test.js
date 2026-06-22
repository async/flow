import assert from "node:assert/strict";
import test from "node:test";
import {
  asyncSignal,
  computed,
  defineFlow,
  flow,
  signal
} from "@async/flow";
import {
  createComputed,
  createFlow,
  createSignal
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

test("flow creates store-like signals and separate refs", () => {
  const cart = flow({
    signals: {
      items: [],
      selectedId: signal(null),
      count: ({ signals }) => signals.items.length,
      isEmpty: computed(({ signals }) => signals.count === 0)
    },
    on: {
      add({ signals, input }) {
        signals.items = [...signals.items, input.item];
      },
      select({ refs, input }) {
        refs.selectedId.set(input.id);
      },
      clear: () => ({ items: [] })
    }
  });

  cart.add({ item: { id: "sku_123" } });
  assert.deepEqual(cart.signals.items, [{ id: "sku_123" }]);
  assert.equal(cart.signals.count, 1);
  assert.equal(cart.signals.isEmpty, false);
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
    signals: {
      count: 0
    },
    on: {
      increment: ({ signals }) => ({ count: signals.count + 1 })
    }
  });

  const first = createFlow(definition);
  const second = createFlow(definition);

  first.increment();
  assert.equal(first.signals.count, 1);
  assert.equal(second.signals.count, 0);
});

test("plain object signal declarations are invalid unless wrapped in signal", () => {
  assert.throws(
    () =>
      flow({
        signals: {
          product: {
            name: "Keyboard"
          }
        }
      }),
    /Nested signal objects are not supported/
  );

  const product = flow({
    signals: {
      product: signal({ name: "Keyboard" })
    }
  });

  assert.deepEqual(product.signals.product, { name: "Keyboard" });
});

test("handler arrays are invalid and returned objects update writable signals", () => {
  assert.throws(
    () =>
      flow({
        on: {
          submit: []
        }
      }),
    /Use run\(\[\.\.\.\]\)/
  );

  const counter = flow({
    signals: {
      count: 0,
      doubled: ({ signals }) => signals.count * 2
    },
    on: {
      increment: ({ signals }) => ({ count: signals.count + 1 }),
      typo: () => ({ coutn: 1 }),
      writeComputed: () => ({ doubled: 10 })
    }
  });

  assert.deepEqual(counter.increment(), { count: 1 });
  assert.equal(counter.signals.doubled, 2);
  assert.throws(() => counter.typo(), /unknown signal "coutn"/);
  assert.throws(() => counter.writeComputed(), /read-only/);
});

test("whole-flow subscribers receive batched change records", () => {
  const changes = [];
  const checkout = flow({
    signals: {
      loading: false,
      orderId: null
    },
    on: {
      submit: ({ input }) => ({
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
      signals: {
        loading: true,
        orderId: "ord_123"
      }
    }
  ]);
});

test("restore updates writable refs and recomputes computed refs", () => {
  const cart = flow({
    signals: {
      items: [],
      count: ({ signals }) => signals.items.length
    }
  });

  cart.restore({ items: [{ id: "sku_123" }], count: 99 });

  assert.equal(cart.signals.count, 1);
  assert.deepEqual(cart.snapshot(), {
    items: [{ id: "sku_123" }],
    count: 1
  });
});

test("asyncSignal creates value and helper-owned status refs", async () => {
  const product = flow({
    signals: {
      id: "sku_123",
      details: asyncSignal(async ({ signals }) => ({ id: signals.id }))
    }
  });

  assert.equal(product.signals.details, undefined);
  assert.equal(product.refs["details.loading"].value, false);
  assert.equal(product.refs["details.error"].value, null);
  assert.equal(product.refs["details.ready"].value, false);

  await product.handlers.refreshDetails();

  assert.deepEqual(product.signals.details, { id: "sku_123" });
  assert.equal(product.refs["details.loading"].value, false);
  assert.equal(product.refs["details.ready"].value, true);
});
