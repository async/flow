# Signals, Computed, Resources, And Store

Flow state starts with small reactive units. A store combines those units behind
an author-facing object while keeping raw refs and resource controllers
available for adapters.

## Signals

Signals are writable refs. Use `signal(value)` in a Flow store declaration, or
`createSignal(value)` when you need a live ref directly.

```js
import { createSignal } from "@async/flow/runtime";

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
```

## Computed Values

Computed values are read-only derived refs. In store declarations, use
`computed((store) => value)` when the derived value should read from the store
proxy.

```js
import { computed } from "@async/flow";
import { createStore } from "@async/flow/runtime";

const cart = createStore({
  items: [],
  count: computed((store) => store.items.length),
  isEmpty: computed((store) => store.count === 0)
});

cart.store.items = [{ id: "sku_123" }];
cart.store.count; // 1
cart.store.isEmpty; // false
```

Computed refs reject writes through the store. Keep writable state in signals,
status refs, resources, or plain writable values.

## Status Values

`status(initial, allowed?)` is a writable signal with optional allowed-value
validation and a public status brand.

```js
import { STATUS, status } from "@async/flow";
import { createStore } from "@async/flow/runtime";

const order = createStore({
  step: status("shipping", ["shipping", "payment", "review"])
});

order.store.step = "payment";
order.refs.step[STATUS]; // true
```

Use status values when a value is finite and meaningful to workflow helpers.

## Resources

`resource(...)` defines an async value for a store. `createResource(...)`
creates a live controller directly.

```js
import { createResource } from "@async/flow/runtime";

const greeting = createResource(async (_store, { signal, input }) => {
  const response = await fetch(`/api/greeting/${input.name}`, { signal });
  return response.text();
});

await greeting.load({ name: "World" });

greeting.status; // "ready"
greeting.value; // loaded text
```

Resources expose the async lifecycle:

```js
resource.status; // "idle" | "loading" | "ready" | "error"
resource.load(input);
resource.reload(input);
resource.cancel(reason);
resource.set(value);
resource.snapshot();
resource.restore(snapshot);
```

Lazy resources stay controller-like in `store`. Immediate resources unwrap to
their current value in `store` and keep their controller under `resources`.

```js
import { resource } from "@async/flow";
import { createStore } from "@async/flow/runtime";

const state = createStore({
  lazyGreeting: resource(async () => "hello"),
  settings: resource({ immediate: true }, async () => ({ theme: "dark" }))
});

state.store.lazyGreeting.load();
state.store.settings; // current immediate value
state.resources.settings.reload();
```

## Store Proxy

`createStore(shape)` returns `{ store, refs, resources }`.

```js
import { computed, signal, status } from "@async/flow";
import { createStore } from "@async/flow/runtime";

const state = createStore({
  name: "World",
  settings: signal({ locale: "en" }),
  greeting: computed((store) => `Hello ${store.name}`),
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
- Lazy resources read as controllers.
- Immediate resources read as current values and keep controllers in
  `resources`.
- Values that are not Flow types stay normal store values.

Use `store` for author-facing reads and writes. Use `refs` and `resources` when
an adapter needs explicit subscriptions, snapshots, direct setters, or resource
lifecycle methods.
