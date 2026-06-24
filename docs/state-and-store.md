# Signals, Computed, Async Signals, And Store

Flow state starts with small reactive units. A store combines those units behind
an author-facing object while keeping async signal controllers available when a
field is intentionally internal.

## Signals

Signals are writable values. Use `signal(value)` in a Flow store declaration,
or `createSignal(value)` when you need a live signal directly.

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

Computed values are read-only derived values. In function expressions, `this` is
the store receiver, so use direct reads such as `this.count`. Options-first
arguments remain available when positional user data is clearer.

```js
import { computed, createStore } from "@async/flow";

const cart = createStore({
  items: [],
  count: computed(function () {
    return this.items.length;
  }),
  isEmpty: computed(function () {
    return this.count === 0;
  })
});

cart.store.items = [{ id: "sku_123" }];
cart.store.count; // 1
cart.store.isEmpty; // false
```

Computed values reject writes through the store. Keep writable state in signals,
status values, async signals, or plain writable values.

## Status Values

`status(initial, allowed?)` creates a writable signal with optional
allowed-value validation and a public status brand. It works on its own or as a
store declaration.

```js
import { createStore, status } from "@async/flow";

const step = status("shipping", ["shipping", "payment", "review"]);

step.set("payment");
step.get(); // "payment"

const order = createStore({ step });

order.store.step; // "payment"
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

greeting.type; // "asyncSignal"
greeting.value; // loaded text
greeting.status; // "ready"
```

Async signals expose the async lifecycle and the readable signal protocol:

```js
asyncController.get();
asyncController.status; // "idle" | "loading" | "ready" | "error"
asyncController.load(...args);
asyncController.reload(...args);
asyncController.cancel(reason);
asyncController.set(value);
asyncController.update(fn);
asyncController.snapshot();
asyncController.restore(snapshot);
```

Public async signals read as current values in `store`. Async signals starting with `_`
signals read as controllers so store getters and handlers can expose a flatter
public shape.

```js
import { asyncSignal, createStore } from "@async/flow";

const state = createStore({
  _lazyGreeting: asyncSignal(async () => "hello"),
  _settings: asyncSignal({ immediate: true }, async () => ({ theme: "dark" })),
  get lazyGreeting() {
    return this._lazyGreeting.get();
  },
  get settings() {
    return this._settings.get();
  }
});

state.store._lazyGreeting.load();
state.store.lazyGreeting; // current lazy value
state.store.settings; // current immediate value
state.store._settings.reload();
```

## Store Proxy

`createStore(shape)` returns store values, refs, async signal controllers, and
controller-capable internal fields.

```js
import { computed, createStore, signal, status } from "@async/flow";

const state = createStore({
  name: "World",
  settings: signal({ locale: "en" }),
  greeting: computed(function () {
    return `Hello ${this.name}`;
  }),
  phase: status("idle", ["idle", "ready"])
});

state.store.name = "Ada";
state.store.greeting; // "Hello Ada"

state.store.phase = "ready";
state.store.settings = { locale: "fr" };
```

The store proxy unwraps known Flow types:

- Signals and status values read as their values and write through `.set(...)`.
- Computed values read as values and reject writes.
- Public async signals read as values and write through `.set(...)`.
- `_` async signals read as controllers and can be exposed through getters.
- Values that are not Flow types stay normal store values.

Use `store` for author-facing reads and writes. Keep lifecycle methods on
internal `_` fields when an adapter needs subscriptions, snapshots, direct
setters, or async signal lifecycle methods. Use `asyncSignals` when integration
code needs the controller namespace directly.
