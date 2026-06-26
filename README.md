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
import { dispatch, flow, status } from "@async/flow";

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

counter.increment({ by: 2 });

counter.count; // 2
counter.phase; // "active"

dispatch(counter, "reset");

counter.count; // 0
counter.phase; // "idle"
```

A Flow instance combines:

- `store`: author-facing values with getter/setter behavior.
- `_`: non-enumerable internal controller namespace for `_` store fields.
- Handler methods from `on`, such as `counter.increment(input)`.
- `dispatch(name, input?)`: dynamic event execution on this Flow instance.
- `subscribe(fn)`: whole-flow change records with `{ name, input, store }`.
- `explain(name, input?)`: structured blocked-event reasons.

The package also provides `compose(...)`, `parallel(...)`, and `remember(...)`
for ordered handler steps. Use imported `can(...)` for event availability and
imported `inspect(...)` for public metadata snapshots.

## Store-Style Events

Every `on` handler is projected onto the Flow instance as a method. Whole-flow
subscribers receive one batched change record after each handler dispatch, and
`change.store` contains the public store snapshot after the handler completes.

```js
import { dispatch, flow } from "@async/flow";

function createDonutStore() {
  return flow({
    store: {
      donuts: 0,
      favoriteFlavor: "chocolate"
    },

    on: {
      addDonut(store) {
        store.donuts += 1;
      },

      changeFlavor(store, event) {
        store.favoriteFlavor = event.flavor;
      },

      eatAllDonuts(store) {
        store.donuts = 0;
      }
    }
  });
}

const donutStore = createDonutStore();

donutStore.subscribe((change) => {
  console.log(change.store);
});

donutStore.addDonut();
// logs { donuts: 1, favoriteFlavor: "chocolate" }

donutStore.changeFlavor({ flavor: "strawberry" });
// logs { donuts: 1, favoriteFlavor: "strawberry" }

const routedDonutStore = createDonutStore();

routedDonutStore.subscribe((change) => {
  console.log(change.store);
});

dispatch(routedDonutStore, "addDonut");
// logs { donuts: 1, favoriteFlavor: "chocolate" }

dispatch(routedDonutStore, "changeFlavor", { flavor: "strawberry" });
// logs { donuts: 1, favoriteFlavor: "strawberry" }
```

Use direct methods when the event is known at author time. Use target-first
`dispatch(target, eventName, input?)` when an adapter receives the target or
event name dynamically, or when the same sender should work with different event
sinks.

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

cart.add({ item: { id: "sku_123" } });

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
import { compose, dispatch, every, flow, matches, not, parallel, set, status, when } from "@async/flow";

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

`dispatch("event", payload?)` creates a reusable deferred sender. In a composed
Flow handler it dispatches to the current Flow receiver; outside Flow it can be
sent to any supported event sink. When the target is already a Flow instance and
the event is known, `checkout.ready(input)` is the direct equivalent of
`dispatch(checkout, "ready", input)`.

```js
const ready = dispatch("ready", { id: 1 });

ready.call(checkout);
ready.call(element);
ready.emit(emitter);
ready.send(sender);

dispatch(checkout, "ready", { id: 1 });
dispatch(element, "ready", { id: 1 });
dispatch(emitter, "ready", { id: 1 });
dispatch(sender, "ready", { id: 1 });
```

## Event Availability And Inspection

Flow can answer whether an event is registered and whether Flow-visible guards,
transitions, or explicit leading availability gates currently allow it without
dispatching the event.

```js
import { can, inspect } from "@async/flow";

can(checkout, "submit").get(); // false while the leading availability gate is blocked
checkout.explain("submit");
// { event: "submit", allowed: false, reason: "not_ready", source: "guard", label: "Submit order" }

checkout.explain("missing");
// { event: "missing", allowed: false, reason: "unknown_event" }
```

Use `inspect(...)` when adapters need stable public metadata:

```js
const description = inspect(checkout);

description.handlers; // ["submit"]
description.store.step.type; // "status"
```

Inspections expose names, current values, lifecycle state, and safe metadata.
They do not expose raw handlers or predicates.

Use `inspect(...)` for standalone status refs, computed refs, transition
helpers, and timer helpers without depending on a Flow instance:

```js
import { after, inspect, status } from "@async/flow";

const phase = status("idle", ["idle", "active"]);
const description = inspect(phase);

description.type; // "status"
description.value; // "idle"
```

`after(ms, callback, input?)` also works without a Flow instance. It returns a
cancellable timer helper.

```js
const markReady = after(100, (next) => {
  phase.set(next);
}, "ready");

const cancel = markReady();
cancel();
```

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
`this.dispatch(name, input)`, `this.explain(name, input)`,
`this.after(ms, eventName, input)`, and `this.dispose(cleanup)`. Imported
`dispatch(...)`, `can(...)`, and `inspect(...)` can also receive a Flow handler
receiver.

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

Graph helpers live in an opt-in subpath and are not re-exported from the root
entrypoint:

```js
import { toGraph, toMermaid } from "@async/flow/graph";
```

Framework integrations that provide their own scheduler can use the
scheduler-free runtime and helper subpaths:

```js
import { createFlow } from "@async/flow/framework-runtime";
import { set, update, when, onError } from "@async/flow/helpers/core";
```

Builder helpers also live in an opt-in subpath. Use them when a graph
declaration should compile into ordinary Flow config while implementation
details come from handler and signal registries:

```js
import { flow } from "@async/flow";
import { toFlowConfig } from "@async/flow/builder";

const payment = flow(toFlowConfig(paymentGraph, {
  handlers: {
    canSubmit,
    chargePayment
  },
  signals: {
    isOnline
  }
}));
```

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
