# @async/flow

Portable store, async signal, and handler runtime for Async packages.

Flow is useful when an app needs signal-like state, event handlers, async
signals, and small workflow helpers without adopting a full statechart engine.

Pick the smallest layer that solves the problem:

- L1 primitives: use `createSignal`, `createComputed`, `createAsyncSignal`, and
  `createStore` when an adapter or library needs explicit refs and controllers.
- L2 Flow: use `flow(...)` when state changes should run through named events
  and batched plain functions.
- L2.5 composition: use `compose(...)` and `parallel(...)` when a Flow handler
  needs ordered or fan-out/fan-in work without a full helper vocabulary.
- L3 steps: use `set(...)`, `when(...)`, `branch(...)`, `dispatch(...)`, and
  `after(...)` when repeated workflow wiring should read as reusable steps.

## Install

```bash
pnpm add @async/flow
```

## Quick Start

```js
import { flow, status } from "@async/flow";

const counter = flow({
  store: {
    count: 0,
    phase: status("idle", ["idle", "active"])
  },

  on: {
    increment(store, input = {}) {
      store.count += input.by ?? 1;
      store.phase = "active";
    },

    reset(store) {
      store.count = 0;
      store.phase = "idle";
    }
  }
});

counter.dispatch("increment", { by: 2 });

counter.store.count; // 2
counter.refs.phase.get(); // "active"
```

A Flow instance combines:

- `store`: author-facing values with getter/setter behavior.
- `refs`: explicit signal, status, computed, and async signal refs for adapters.
- `resources`: compatibility view of async signal controllers.
- `dispatch(name, input)`: event execution.
- `can(name, input?)`: event availability checks.
- `explain(name, input?)`: structured blocked-event reasons.
- `describe()`: public inspection metadata for stores, resources, handlers,
  transitions, and guards.

The package also provides `compose(...)`, `parallel(...)`, and `remember(...)`
for ordered handler steps.

## Store Values

Plain primitives and arrays become writable store refs. Computed values are
read-only. Plain record values stay explicit; use `signal(value)` when an object
should be a single writable value.

```js
import { computed, flow, signal, status } from "@async/flow";

const cart = flow({
  store: {
    items: [],
    settings: signal({ currency: "USD" }),
    count: computed(function () {
      return this.store.items.length;
    }),
    isEmpty: computed({ arguments: (store) => [store.count] }, (count) => count === 0),
    phase: status("idle", ["idle", "ready"])
  },

  on: {
    add(store, input) {
      store.items = [...store.items, input.item];
      store.phase = "ready";
    }
  }
});

cart.dispatch("add", { item: { id: "sku_123" } });

cart.store.count; // 1
cart.refs.items.get(); // [{ id: "sku_123" }]
cart.store.settings = { currency: "EUR" };
```

## Async Signals

`asyncSignal(loader)` declares a lazy async value with lifecycle state and
explicit controls. Loaders receive user data from `options.arguments` or
explicit `load(...args)` calls. Flow context and lifecycle tools are available
through the function receiver.

```js
import { asyncSignal, flow } from "@async/flow";

const greeting = flow({
  store: {
    name: "World",
    greeting: asyncSignal({ arguments: (store) => [store.name] }, async function (name) {
      const response = await fetch(`/api/greeting/${name}`, { signal: this.signal });
      return response.text();
    })
  },

  on: {
    fetch() {
      return this.refs.greeting.load();
    },

    reload() {
      return this.refs.greeting.reload();
    },

    cancel(_store, reason) {
      return this.refs.greeting.cancel(reason);
    }
  }
});

await greeting.dispatch("fetch");

greeting.store.greeting; // loaded text
greeting.refs.greeting.status; // "ready"
```

Lazy and immediate async signals both read as current values through `store`.
The controller lives under `refs`; `resources` remains a compatibility view of
the same controller.

```js
const profile = flow({
  store: {
    user: asyncSignal({ immediate: true }, async function () {
      const response = await fetch("/api/user", { signal: this.signal });
      return response.json();
    })
  },

  on: {
    refreshUser() {
      return this.refs.user.reload();
    }
  }
});

profile.store.user; // current value
profile.refs.user.status; // "loading", "ready", or "error"
profile.resources.user === profile.refs.user; // true
```

More detail: [Async Signal Lifecycle](docs/resources.md).

## Compose And Step Workflows

Use `compose(...)` for ordered steps that should share one Flow handler input.
Each step receives `(store, input, previous)`. Use `parallel(...)` when one
ordered step should run independent effects before continuing. Use root-exported
step helpers when the repeated parts are store writes, gates, branches, event
dispatches, or scheduled follow-up events.

```js
import { compose, flow, parallel, set, status, when } from "@async/flow";

const checkout = flow({
  store: {
    step: status("shipping", ["shipping", "payment", "review"]),
    canSubmit: true,
    loading: false,
    orderId: null
  },

  on: {
    submit: compose([
      when((store) => store.step === "review" && store.canSubmit),
      set("loading", true),
      parallel({
        inventory(_store, input) {
          return reserveInventory(input.form);
        },
        tax(_store, input) {
          return calculateTax(input.form);
        }
      }),
      async (_store, input) => {
        const order = await submitOrder(input.form);
        return order.id;
      },
      (store, _input, orderId) => {
        store.orderId = orderId;
      },
      set("loading", false)
    ])
  }
});
```

`compose` stays synchronous until a step returns a promise-like value. Flow then
flushes the current synchronous batch and resumes later steps in a fresh batch.
That lets `loading = true` render before async work settles.

More detail: [Compose And Status Helpers](docs/compose-and-status.md).

## Event Availability And Inspection

Flow can answer whether an event is callable now without dispatching it.

```js
checkout.can("submit"); // true for this plain composed handler
checkout.explain("missing");
// { event: "missing", allowed: false, reason: "unknown_event" }
```

Use `describe()` when adapters or tests need stable public metadata:

```js
const description = checkout.describe();

description.handlers; // ["submit"]
description.store.step.kind; // "status"
```

Descriptions expose names, current values, lifecycle state, and safe metadata.
They do not expose raw handlers or predicates.

## Runtime Options

The top-level authoring helper accepts either config or options plus config.

```js
flow(config);
flow({ scheduler, context }, config);
```

With two arguments, the first object is always runtime options and the second is
always Flow config.

Handlers receive `(store, input)`. Runtime capabilities are available through
method syntax or normal functions:

```js
const appFlow = flow(
  {
    context() {
      return { logger: console };
    }
  },
  {
    store: {
      count: 0
    },

    on: {
      increment(store, input) {
        store.count += input.by;
        this.logger.log(store.count);
        return this.dispatch("read");
      },

      read(store) {
        return store.count;
      }
    }
  }
);
```

Receiver capabilities include `this.store`, `this.refs`, `this.resources`,
`this.dispatch(name, input)`, `this.can(name, input)`,
`this.explain(name, input)`, `this.describe()`,
`this.after(ms, eventName, input)`, and `this.dispose(cleanup)`.

## Root And Subpaths

The root package exports the complete opinionated Flow surface. Use subpaths
when a consumer wants a narrower entrypoint.

```js
import {
  after,
  asyncSignal,
  branch,
  compose,
  computed,
  createAsyncSignal,
  createFlow,
  createSignal,
  createStore,
  defineAsyncSignal,
  defineFlow,
  dispatch,
  flow,
  parallel,
  remember,
  set,
  signal,
  status,
  when
} from "@async/flow";
```

The old `@async/flow/run` subpath is not public. Use the root `compose(...)`
export or the narrow `@async/flow/compose` entrypoint.

## Docs

- [Docs Index](docs/README.md)
- [Layer Guide](docs/layers.md)
- [Signals, Computed, Async Signals, And Store](docs/state-and-store.md)
- [Async Signal Lifecycle](docs/resources.md)
- [Compose And Status Helpers](docs/compose-and-status.md)

## Package Checks

```bash
pnpm test
pnpm run typecheck
pnpm run pack:check
```
