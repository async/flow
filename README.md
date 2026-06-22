# @async/flow

Portable signal state and handler functions for Async packages.

Flow is a small runtime for workflows that are mostly state plus named
actions. It can run standalone, or it can be mounted by `@async/framework`
through the framework registry so Flow signals and handlers become ordinary
framework `signal` and `handler` entries.

## Install

```bash
pnpm add @async/flow
```

Flow requires Node.js 24 or newer for package verification. The runtime itself
is ESM-only and publishes `.js` source with `.d.ts` declarations.

## Quick Start

```js
import { computed, flow, signal } from "@async/flow";

const cart = flow({
  signals: {
    items: signal([]),
    selectedId: signal(null),
    count: computed(({ signals }) => signals.items.length)
  },

  on: {
    add({ signals, input }) {
      signals.items = [...signals.items, input.item];
    },

    select({ refs, input }) {
      refs.selectedId.set(input.id);
    },

    clear() {
      return { items: [] };
    }
  }
});

cart.add({ item: { id: "sku_123" } });
cart.select({ id: "sku_123" });

cart.signals.count; // 1
cart.refs.selectedId.value; // "sku_123"
cart.snapshot(); // { items: [...], selectedId: "sku_123", count: 1 }
```

Flow exposes two views over the same state:

- `signals` is the store-like authoring object. Reads return current values and
  assignments write writable signals.
- `refs` is the explicit signal-ref map for adapters and advanced code:
  `refs.items.get()`, `refs.items.set(next)`, and `refs.items.value`.

## Layers

Flow is intentionally layered so teams can choose the amount of structure they
need.

### L1: Signal Runtime

Layer 1 is Flow without the runner. It gives you signals, computed values,
async signal families, plain handler functions, snapshots, restore, and
subscriptions.

Use L1 when a workflow is easiest to read as direct signal updates:

```js
import { asyncSignal, computed, flow, signal } from "@async/flow";

const product = flow({
  signals: {
    id: signal("sku_123"),
    details: asyncSignal(async ({ signals }) => {
      const response = await fetch(`/products/${signals.id}`);
      return response.json();
    }),
    readyLabel: computed(({ signals }) =>
      signals["details.ready"] ? "ready" : "loading"
    )
  },

  on: {
    choose({ signals, input }) {
      signals.id = input.id;
    }
  }
});

await product.refreshDetails();
```

L1 rules:

- Signal declarations use `signal(value)` when the value is a plain object.
- Plain arrays or primitives may be used directly as signal values.
- Plain object values must be wrapped with `signal(value)` so nested state is
  explicit.
- Computed values are read-only and derive from the same `signals` object.
- `asyncSignal(loader)` creates a value signal plus `.loading`, `.error`, and
  `.ready` helper signals, and a `refreshName` handler.
- `on` entries must be functions. Arrays are invalid directly in `on`.

### L2: Runner And Helper Pipelines

Layer 2 adds `run(...)` and small helper functions. `run` accepts one function
or an array of functions and returns a normal handler function, so it can be
used anywhere a Flow handler can be used.

```js
import { flow, run, set, update, when } from "@async/flow";

const checkout = flow({
  signals: {
    canSubmit: true,
    loading: false,
    orderId: null
  },

  on: {
    submit: run([
      when(({ signals }) => signals.canSubmit),
      set("loading", true),
      async ({ input }) => {
        const order = await submitOrder(input.form);
        return {
          loading: false,
          orderId: order.id
        };
      }
    ]),

    retry: update("orderId", () => null)
  }
});
```

L2 helpers:

- `run(fn)` and `run([fn, ...])` return normal functions.
- `set(name, value)` writes one signal.
- `set({ name: value })` writes multiple signals.
- `update(name, fn)` writes a signal from its current value.
- `when(predicate)` stops a runner when the predicate is false.
- `onError(handle, handler)` maps sync throws and async rejections.

`run` preserves synchronous execution until an async step is reached. After an
async step, remaining steps continue through a promise chain.

### L3: Strict Helpers

Layer 3 adds optional strict helpers for workflows that benefit from explicit
allowed states without adopting a statechart engine.

```js
import { can, flow, guard, matches, state, transition } from "@async/flow";

const checkout = flow({
  signals: {
    step: state("shipping", ["shipping", "payment", "review"]),
    canContinue: can("next"),
    inReview: matches("review"),
    loading: false,
    error: null
  },

  on: {
    next: transition([
      { from: "shipping", to: "payment" },
      { from: "payment", to: "review" }
    ]),

    back: transition([
      { from: "review", to: "payment" },
      { from: "payment", to: "shipping" }
    ]),

    submit: guard(
      ({ signals }) => signals.step === "review" && !signals.loading,
      async ({ signals, input }) => {
        signals.loading = true;
        const order = await submitOrder(input.form);
        return {
          loading: false,
          error: null,
          orderId: order.id
        };
      }
    )
  }
});
```

L3 helpers:

- `state(initial, allowed)` declares a writable signal with allowed values.
- Writing an invalid state value throws.
- `transition(config)` returns a handler that writes the state signal when a
  matching rule exists.
- Missing transition matches are a no-op.
- `guard(predicate, handler)` skips the handler when the predicate is false.
- `can(eventName)` is a computed value from transition metadata.
- `matches(value)` is a computed value for the current state signal.

Strict helpers stay signal-native. They do not add actors, spawned children,
parallel states, history states, delayed transitions, visual tooling, or full
statechart execution.

## API Shape

### `flow(config, options?)`

Creates a live Flow instance:

```js
const machine = flow({
  signals: {},
  on: {}
});
```

Instances expose:

- `flow.signals`
- `flow.refs`
- `flow.handlers`
- `flow.get(name)`
- `flow.set(name, value)`
- `flow.update(name, fn)`
- `flow.run(name, input)`
- `flow.snapshot()`
- `flow.restore(snapshot)`
- `flow.subscribe(name, fn)`
- `flow.subscribe(fn)`
- `flow.destroy()`

Each handler is also available as a method when its name does not conflict with
reserved instance methods:

```js
cart.add(input);
cart.run("add", input);
```

Both calls run the same handler.

### Signal Declarations

```js
import { asyncSignal, computed, signal, state } from "@async/flow";

const profile = flow({
  signals: {
    name: "Ada",
    settings: signal({ theme: "dark" }),
    initials: computed(({ signals }) => signals.name.slice(0, 1)),
    remote: asyncSignal(loadProfile),
    status: state("idle", ["idle", "saving", "saved", "failed"])
  }
});
```

Signal declaration behavior:

- Primitives and arrays may be declared directly.
- Plain objects must use `signal(value)`.
- Computed declarations may use `computed(fn)` or a plain function in the
  `signals` map.
- Computed signals are read-only.
- `state(initial, allowed)` is a normal writable signal with validation.

### Handler Context

Handlers receive one context object:

```js
function handler({ flow, signals, refs, input }) {
  signals.count = signals.count + 1;
  refs.selectedId.set(input.id);
  return { loading: false };
}
```

Returned plain objects are treated as signal updates. Unknown signal names and
computed writes throw.

### Snapshots And Restore

Snapshots are plain signal values:

```js
const snapshot = cart.snapshot();
cart.restore(snapshot);
```

Restore updates writable signals and lets computed values recompute from their
dependencies. Read-only computed snapshot entries are ignored.

### Subscriptions

Subscribe to one signal:

```js
const stop = cart.subscribe("items", (items) => {
  console.log(items.length);
});
```

Subscribe to batched flow changes:

```js
const stop = cart.subscribe((change) => {
  console.log(change.name, change.signals);
});
```

## Scheduler

Flow uses a small scheduler contract:

```js
const scheduler = {
  batch(fn) {
    return fn();
  },
  enqueue(fn) {
    queueMicrotask(fn);
  },
  async flush() {}
};
```

Create a Flow with an explicit scheduler:

```js
const cart = flow(config, { scheduler });
```

Default scheduler controls are available for future Flow creations:

```js
import {
  createDefaultScheduler,
  getDefaultScheduler,
  resetDefaultScheduler,
  setDefaultScheduler
} from "@async/flow";
```

Framework adapters can provide their own scheduler without changing author
code.

## Framework Integration

`@async/framework` mounts Flow through the framework registry:

```js
import { Async, flow, signal } from "@async/framework";

const cart = flow({
  signals: {
    items: signal([])
  },
  on: {
    add({ signals, input }) {
      signals.items = [...signals.items, input];
    }
  }
});

Async.use("flow", { cart });
```

Framework mounting lowers Flow into normal registry entries:

- Flow signals become framework `signal` entries such as `cart.items`.
- Flow handlers become framework `handler` entries such as `cart.add`.
- Flow async-signal helper paths become normal signal entries.
- Flow snapshot and restore use ordinary framework signal snapshots.
- Framework scheduling owns DOM binding timing.

There is no `app.flow(...)` API. Use `app.use("flow", { name: flow(...) })`,
`Async.use("flow", { name: flow(...) })`, or `Async.use({ flow: { name } })`.

## Subpaths

```js
import { flow, signal, computed, asyncSignal } from "@async/flow";
import { defineFlow } from "@async/flow/define";
import { createFlow, createSignal } from "@async/flow/runtime";
import { run } from "@async/flow/run";
import { set, transition } from "@async/flow/helpers";
import { setDefaultScheduler } from "@async/flow/scheduler";
```

Subpath roles:

- `@async/flow`: standalone runtime API plus helpers.
- `@async/flow/define`: import-safe declaration helpers for adapters.
- `@async/flow/runtime`: low-level signal and Flow constructors.
- `@async/flow/run`: generic function runner.
- `@async/flow/helpers`: pipeline and strict helper functions.
- `@async/flow/scheduler`: scheduler controls.

## Verification

```bash
pnpm test
pnpm run typecheck
pnpm run pack:check
pnpm run release:check
```

`release:check` is the package handoff gate. It runs the Async Pipeline verify
job once the package pipeline surfaces are in sync.
