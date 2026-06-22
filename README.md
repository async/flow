# @async/flow

Portable store, resource, and handler runtime for Async packages.

Flow is useful when an app needs signal-like state, event handlers, async
resources, and small workflow helpers without adopting a full statechart engine.

Pick the smallest layer that solves the problem:

- L1 primitives: use `createSignal`, `createComputed`, `createResource`, and
  `createStore` when an adapter or library needs explicit refs and controllers.
- L2 Flow: use `flow(...)` when state changes should run through named events
  and batched handlers.
- L3 helpers: use `compose(...)`, `status(...)`, `transition(...)`, and guards
  when a workflow benefits from reusable steps and finite status helpers.

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
- `refs`: explicit signal, status, and computed refs for adapters.
- `resources`: mounted async resources and their controllers.
- `dispatch(name, input)`: event execution.
- `compose([...])`: ordered handler steps from `@async/flow/compose`.

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
    count: (store) => store.items.length,
    isEmpty: computed((store) => store.count === 0),
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

## Resources

`resource(loader)` declares a lazy async value with lifecycle state and explicit
controls. The loader receives the store plus tools containing a native abort
signal, the load input, and the resource version.

```js
import { flow, resource } from "@async/flow";

const greeting = flow({
  store: {
    name: "World",
    greeting: resource(async (store, { signal }) => {
      const response = await fetch(`/api/greeting/${store.name}`, { signal });
      return response.text();
    })
  },

  on: {
    fetch(store) {
      return store.greeting.load();
    },

    reload(store) {
      return store.greeting.reload();
    },

    cancel(store, reason) {
      return store.greeting.cancel(reason);
    }
  }
});

await greeting.dispatch("fetch");

greeting.store.greeting.status; // "ready"
greeting.store.greeting.value; // loaded text
```

Lazy resources stay as controller objects in `store`. Immediate resources read
as values through `store` and keep their controller under `flow.resources`.

```js
const profile = flow({
  store: {
    user: resource({ immediate: true }, async (_store, { signal }) => {
      const response = await fetch("/api/user", { signal });
      return response.json();
    })
  },

  on: {
    refreshUser() {
      return this.resources.user.reload();
    }
  }
});

profile.store.user; // current value
profile.resources.user.status; // "loading", "ready", or "error"
```

More detail: [Resource Lifecycle](docs/resources.md).

## Compose And Status Workflows

Use `compose(...)` for ordered steps that should share one Flow handler input.
Each step receives `(store, input, previous)`.

```js
import { flow, set, status, transition, when } from "@async/flow";
import { compose } from "@async/flow/compose";

const checkout = flow({
  store: {
    step: status("shipping", ["shipping", "payment", "review"]),
    canSubmit: true,
    loading: false,
    orderId: null
  },

  on: {
    next: transition("step", {
      shipping: "payment",
      payment: "review"
    }),

    submit: compose([
      when((store) => store.step === "review" && store.canSubmit),
      set("loading", true),
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
`this.dispatch(name, input)`, `this.after(ms, eventName, input)`, and
`this.dispose(cleanup)`.

## Public Subpaths

```js
import { flow, signal, status, computed, resource } from "@async/flow";
import { compose } from "@async/flow/compose";
import { createFlow, createResource, createStore, createSignal } from "@async/flow/runtime";
import { defineFlow, defineResource } from "@async/flow/define";
import { createResource as createStandaloneResource } from "@async/flow/resource";
```

The old `@async/flow/run` subpath is not public. Use
`@async/flow/compose`.

## Docs

- [Docs Index](docs/README.md)
- [Layer Guide](docs/layers.md)
- [Signals, Computed, Resources, And Store](docs/state-and-store.md)
- [Resource Lifecycle](docs/resources.md)
- [Compose And Status Helpers](docs/compose-and-status.md)

## Package Checks

```bash
pnpm test
pnpm run typecheck
pnpm run pack:check
```
