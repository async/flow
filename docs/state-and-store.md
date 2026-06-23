# Signals, Computed, Async Signals, And Store

Flow state starts with small reactive units. A store combines those units behind
an author-facing object while keeping raw refs and async signal controllers
available for adapters.

## Signals

Signals are writable refs. Use `signal(value)` in a Flow store declaration, or
`createSignal(value)` when you need a live ref directly.

```js
import { createSignal } from "@async/flow";

const count = createSignal(0);

count.get(); // 0
count.set(1);
count.update((value) => value + 1);
count.value; // 2
```

Signals expose:

```js
signal.get();
signal.set(next);
signal.update(fn);
signal.subscribe(fn);
signal.snapshot();
signal.restore(snapshot);
```

## Computed Values

Computed values are read-only derived refs. Use function expressions when a
computed callback should read from the store receiver, or options-first
arguments when positional user data is clearer.

```js
import { computed, createStore } from "@async/flow";

const cart = createStore({
  items: [],
  count: computed(function () {
    return this.store.items.length;
  }),
  isEmpty: computed({ arguments: (store) => [store.count] }, (count) => count === 0)
});

cart.store.items = [{ id: "sku_123" }];
cart.store.count; // 1
cart.store.isEmpty; // false
```

Computed refs reject writes through the store. Keep writable state in signals,
status refs, async signals, or plain writable values.

## Status Values

`status(initial, allowed?)` is a writable signal with optional allowed-value
validation and a public status brand.

```js
import { STATUS, createStore, status } from "@async/flow";

const order = createStore({
  step: status("shipping", ["shipping", "payment", "review"])
});

order.store.step = "payment";
order.refs.step[STATUS]; // true
```

Use status values when a value is finite and meaningful to workflow helpers.

## Async Signals

`asyncSignal(...)` defines an async value for a store. `createAsyncSignal(...)`
creates a live controller directly.

```js
import { createAsyncSignal } from "@async/flow";

const greeting = createAsyncSignal(async function (input) {
  const response = await fetch(`/api/greeting/${input.name}`, {
    signal: this.signal
  });
  return response.text();
});

await greeting.load({ name: "World" });

greeting.kind; // "asyncSignal"
greeting.value; // loaded text
greeting.status; // "ready"
```

Async signals expose the async lifecycle and the readable signal protocol:

```js
asyncRef.get();
asyncRef.status; // "idle" | "loading" | "ready" | "error"
asyncRef.load(...args);
asyncRef.reload(...args);
asyncRef.cancel(reason);
asyncRef.set(value);
asyncRef.update(fn);
asyncRef.snapshot();
asyncRef.restore(snapshot);
```

Lazy and immediate async signals both read as current values in `store`. Their
controllers live under `refs`; `resources` is a compatibility view of the same
controllers.

```js
import { asyncSignal, createStore } from "@async/flow";

const state = createStore({
  lazyGreeting: asyncSignal(async () => "hello"),
  settings: asyncSignal({ immediate: true }, async () => ({ theme: "dark" }))
});

state.refs.lazyGreeting.load();
state.store.lazyGreeting; // current lazy value
state.store.settings; // current immediate value
state.refs.settings.reload();
state.resources.settings === state.refs.settings; // true
```

## Store Proxy

`createStore(shape)` returns `{ store, refs, resources }`.

```js
import { computed, createStore, signal, status } from "@async/flow";

const state = createStore({
  name: "World",
  settings: signal({ locale: "en" }),
  greeting: computed(function () {
    return `Hello ${this.store.name}`;
  }),
  phase: status("idle", ["idle", "ready"])
});

state.store.name = "Ada";
state.store.greeting; // "Hello Ada"

state.refs.name.get(); // "Ada"
state.refs.phase.set("ready");
state.store.settings = { locale: "fr" };
```

The store proxy unwraps known Flow types:

- Signals and status refs read as their values and write through `.set(...)`.
- Computed refs read as values and reject writes.
- Async signals read as values and write through `.set(...)`.
- Async signal controllers are available through `refs`, with `resources` kept
  as a compatibility view.
- Values that are not Flow types stay normal store values.

Use `store` for author-facing reads and writes. Use `refs` and `resources` when
an adapter needs explicit subscriptions, snapshots, direct setters, or async
signal lifecycle methods.
