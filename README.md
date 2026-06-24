# @async/flow

Portable store, async signal, and handler runtime for Async packages.

Flow is useful when an app needs signal-like state, event handlers, async
signals, and small workflow helpers without adopting a full statechart engine.

Pick the smallest layer that solves the problem:

- L1 primitives: use `createSignal`, `createComputed`, `createAsyncSignal`, and
  `createStore` when an adapter or library needs explicit values and controllers.
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

counter.count; // 2
counter.phase; // "active"
```

A Flow instance combines:

- `store`: author-facing values with getter/setter behavior.
- `_`: non-enumerable internal controller namespace for `_` store fields.
- `dispatch(name, input)`: event execution.
- `can(name, input?)`: event availability checks.
- `explain(name, input?)`: structured blocked-event reasons.
- `describe()`: public inspection metadata for stores, handlers, transitions,
  and guards.

The package also provides `compose(...)`, `parallel(...)`, and `remember(...)`
for ordered handler steps.

## Store Values

Plain primitives and arrays become writable store values. Computed values are
read-only. Plain record values stay explicit; use `signal(value)` when an object
should be a single writable value.

```js
import { computed, flow, signal, status } from "@async/flow";

const cart = flow({
  store: {
    items: [],
    settings: signal({ currency: "USD" }),
    count: computed(function () {
      return this.items.length;
    }),
    isEmpty: computed(function () {
      return this.count === 0;
    }),
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

cart.count; // 1
cart.items; // [{ id: "sku_123" }]
cart.settings = { currency: "EUR" };
```

Computed function callbacks read store values directly from `this`.

## Async Signals

`asyncSignal(loader)` declares a lazy async value with lifecycle state and
explicit controls. Loaders read Flow store data through `this.store`; lifecycle
tools are available through the function receiver.

```js
import { asyncSignal, flow } from "@async/flow";

const greeting = flow({
  store: {
    name: "World",
    _request: asyncSignal(async function () {
      const response = await fetch(`/api/greeting/${this.store.name}`, {
        signal: this.signal
      });
      return response.text();
    }),
    get status() {
      return this._request.status;
    },
    get value() {
      return this._request.get();
    }
  },

  on: {
    fetch() {
      return this.store._request.load();
    },

    reload() {
      return this.store._request.reload();
    },

    cancel(_store, reason) {
      return this.store._request.cancel(reason);
    }
  }
});

await greeting.fetch();

greeting.value; // loaded text
greeting.status; // "ready"
```

Lazy and immediate async signals can both use internal fields starting with `_` for
controller methods while exposing public getters as normal Flow values.

```js
const profile = flow({
  store: {
    _user: asyncSignal({ immediate: true }, async function () {
      const response = await fetch("/api/user", { signal: this.signal });
      return response.json();
    }),
    get user() {
      return this._user.get();
    },
    get status() {
      return this._user.status;
    }
  },

  on: {
    reloadUser() {
      return this.store._user.reload();
    }
  }
});

profile.user; // current value
profile.status; // "loading", "ready", or "error"
```

More detail: [Async Signal Lifecycle](docs/async-signals.md).

## Compose And Step Workflows

Use `compose(...)` for ordered steps that should share one Flow handler input.
Each step receives `(store, input, previous)`. Use `parallel(...)` when one
ordered step should run independent effects before continuing. Use root-exported
step helpers when the repeated parts are store writes, gates, branches, event
dispatches, or scheduled follow-up events.

```js
import { compose, every, flow, matches, not, parallel, set, status, when } from "@async/flow";

const checkout = flow({
  store: {
    step: status("shipping", ["shipping", "payment", "review"]),
    canSubmit: true,
    readyToSubmit: every(matches("step", "review"), (store) => store.canSubmit),
    blocked: not((store) => store.readyToSubmit),
    loading: false,
    orderId: null
  },

  on: {
    submit: compose([
      when((store) => store.readyToSubmit, {
        availability: true,
        reason: "not_ready",
        label: "Submit order"
      }),
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

Flow can answer whether an event is registered and whether Flow-visible guards,
transitions, or explicit leading availability gates currently allow it without
dispatching the event.

```js
checkout.can("submit"); // false while the leading availability gate is blocked
checkout.explain("submit");
// { event: "submit", allowed: false, reason: "not_ready", source: "guard", label: "Submit order" }

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

Receiver capabilities include `this.store`, `this.refs`, `this.asyncSignals`,
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
  bool,
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
  every,
  flow,
  matches,
  not,
  parallel,
  remember,
  set,
  signal,
  some,
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
- [Async Signal Lifecycle](docs/async-signals.md)
- [Compose And Status Helpers](docs/compose-and-status.md)

## Package Checks

```bash
pnpm test
pnpm run typecheck
pnpm run pack:check
```
