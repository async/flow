# @async/flow

Portable signal state and handler runtime for Async packages.

Flow is a small store and event layer. A Flow instance combines:

- `store`: author-facing values with getter/setter behavior.
- `refs`: explicit signal, status, and computed refs for adapters.
- `resources`: mounted resource instances for higher-level integrations.
- `dispatch(name, input)`: event execution.
- `compose([...])`: ordered handler steps.

## Install

```bash
pnpm add @async/flow
```

## Store And Dispatch

```js
import { computed, flow, signal, status } from "@async/flow";

const cart = flow({
  store: {
    items: [],
    selectedId: signal(null),
    count: (store) => store.items.length,
    isEmpty: computed((store) => store.count === 0),
    phase: status("idle", ["idle", "ready"])
  },

  on: {
    add(store, input) {
      store.items = [...store.items, input.item];
      store.phase = "ready";
    },

    select(store, input) {
      this.refs.selectedId.set(input.id);
    }
  }
});

cart.dispatch("add", { item: { id: "sku_123" } });

cart.store.count; // 1
cart.refs.items.get(); // [{ id: "sku_123" }]
cart.store.phase = "idle";
```

Plain primitive and array values become writable store refs. Computed values are
read-only. Plain record values are intentionally explicit; wrap them with
`signal(value)` when the object should be a single writable value.

```js
const settingsFlow = flow({
  store: {
    settings: signal({ theme: "dark" })
  }
});
```

## Native Store

Use `createStore(...)` when state is needed without event dispatch.

```js
import { createStore } from "@async/flow/runtime";
import { computed, status } from "@async/flow";

const state = createStore({
  count: 0,
  doubled: computed((store) => store.count * 2),
  phase: status("idle", ["idle", "loading", "ready"])
});

state.store.count += 1;
state.store.doubled; // 2
state.refs.phase.set("loading");
state.snapshot();
```

The store proxy unwraps signal-like entries for reads and writes through writable
refs for assignments. Computed entries reject writes.

## Resources

`resource(loader)` declares a lazy async value with lifecycle state and explicit
controls. The loader receives the current store plus tools containing a native
abort signal, the load input, and the resource version.

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

    retry(store) {
      return store.greeting.reload();
    },

    cancel(store) {
      return store.greeting.cancel();
    }
  }
});
```

Lazy resources stay as resource objects in the store:

```js
greeting.store.greeting.status; // "idle"
await greeting.dispatch("fetch");
greeting.store.greeting.value; // loaded text
```

`resource({ immediate: true }, loader)` starts loading when the Flow is created
and reads as a value through `store`. The controller is always available through
`flow.resources.name` and `this.resources.name`.

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

Resources expose `value`, `status`, `loading`, `ready`, `error`, `version`,
`load(input)`, `reload(input)`, `set(value)`, and `cancel(reason)`. Resource
store assignment is intentionally rejected; use resource methods for async side
effects and cache writes.

## Handlers

Handlers receive `(store, input)`. Runtime capabilities are available through
the receiver for method syntax and normal functions.

```js
const counter = flow(
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

Receiver capabilities include:

- `this.store`
- `this.refs`
- `this.resources`
- `this.dispatch(name, input)`
- `this.after(ms, eventName, input)`
- `this.dispose(cleanup)`

Arrow handlers work when they only need `(store, input)`.

## Compose

`compose(fn)` and `compose([fn, ...])` return normal handler functions. Each step
receives `(store, input, previous)`. `input` is the stable dispatch input.
`previous` starts as `undefined` and becomes the last non-`undefined` value
returned by an earlier step.

```js
import { compose } from "@async/flow/compose";
import { flow, set, update, when } from "@async/flow";

const checkout = flow({
  store: {
    canSubmit: true,
    loading: false,
    orderId: null
  },

  on: {
    submit: compose([
      when((store) => store.canSubmit),
      set("loading", true),
      async (_store, input) => ({
        loading: false,
        orderId: input.orderId
      })
    ])
  }
});
```

Returned plain objects are applied as store updates by Flow. Helper functions
such as `set`, `update`, `when`, `guard`, `onError`, `transition`, `can`, and
`matches` use the same store-first handler shape.

## Status Values

`status(initial, allowed?)` declares a writable finite status value. Allowed
values are validated when provided.

```js
import { flow, status, transition } from "@async/flow";

const order = flow({
  store: {
    step: status("shipping", ["shipping", "payment", "review"])
  },

  on: {
    next: transition([
      { from: "shipping", to: "payment" },
      { from: "payment", to: "review" }
    ])
  }
});
```

Live status refs carry `Symbol.for("@async/flow.status")` and expose the same
getter, setter, updater, subscriber, and snapshot methods as writable signal
refs.

## Runtime Options

The top-level authoring helper accepts either a config or options plus config.

```js
flow(config);
flow({ scheduler, context }, config);
```

With two arguments, the first object is always runtime options and the second is
always Flow config. One-argument calls are always config.

The lower-level constructor keeps the explicit order:

```js
createFlow(definitionOrConfig, { scheduler, context });
```

## Public Subpaths

```js
import { flow, signal, status, computed } from "@async/flow";
import { createFlow, createResource, createStore, createSignal } from "@async/flow/runtime";
import { defineFlow, defineResource } from "@async/flow/define";
import { resource } from "@async/flow/resource";
import { compose } from "@async/flow/compose";
```

## Package Checks

```bash
pnpm test
pnpm run typecheck
pnpm run pack:check
```
