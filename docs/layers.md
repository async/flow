# Layer Guide

`@async/flow` is built in layers. Each layer keeps the lower layer available and
adds only the authoring shape needed for that level of workflow structure.

Use the lowest layer that keeps the code clear. Move up when repeated patterns
become part of the application design instead of local state mechanics.

## L1: Primitives And Store

L1 is the live state layer. It is useful for adapters, framework integrations,
tests, and small state units that do not need named events yet.

### Signals And Computed Values

Signals are writable refs with `get`, `set`, `update`, `subscribe`, and
`snapshot`. Writable refs also expose `restore`. Computed values are read-only
refs derived from signals or other store values.

```js
import { createComputed, createSignal } from "@async/flow";

const count = createSignal(1);
const doubled = createComputed(() => count.value * 2);

count.set(2);
doubled.value; // 4
```

### Async Signals

Async signals are async value controllers with `load`, `reload`, `cancel`,
`set`, lifecycle status, snapshots, and subscriptions.

```js
import { createAsyncSignal } from "@async/flow";

const greeting = createAsyncSignal(async function (input) {
  return `Hello ${input.name}`;
});

await greeting.load({ name: "Ada" });

greeting.status; // "ready"
greeting.value; // "Hello Ada"
```

### Store Proxy

Stores wrap signals, computed values, async signals, and plain writable values
in one author-facing proxy while keeping raw refs available for adapters.

```js
import { asyncSignal, computed, createStore, signal } from "@async/flow";

const state = createStore({
  count: 0,
  settings: signal({ currency: "USD" }),
  doubled: computed(function () {
    return this.store.count * 2;
  }),
  greeting: asyncSignal({ arguments: (store) => [store.settings.currency] }, async (currency) => {
    return `Hello ${currency}`;
  })
});

state.store.count += 1;
state.store.doubled; // 2
state.refs.count.get(); // 1
await state.refs.greeting.load();
state.store.greeting; // "Hello USD"
```

Choose L1 when:

- You are integrating Flow state into another runtime or framework.
- You need direct refs or async signal controllers.
- There is no useful event vocabulary yet.
- Tests or adapters need small state units without a full Flow instance.

## L2: Flow Events And Status

L2 adds named events, handler batching, snapshots, receiver capabilities, and
finite status values. Handlers are still just functions.

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
```

Choose L2 when:

- State changes should be named actions such as `increment`, `fetch`, or
  `submit`.
- Subscribers should see batched handler changes.
- Handlers need `this.dispatch(...)`, `this.after(...)`, `this.refs`, or
  injected runtime context.
- UI controls or adapters need `can(...)`, `explain(...)`, or `describe()`
  without dispatching events.

## L2.5: Composition And Parallel Effects

L2.5 keeps plain functions but lets one handler read as ordered work. Use
`compose(...)` for steps and `parallel(...)` for fan-out/fan-in effects. This
layer does not require guards, branches, store-write helpers, or scheduling
helpers.

```js
import { compose, flow, parallel, status } from "@async/flow";

const checkout = flow({
  store: {
    step: status("review", ["review", "submitted"]),
    loading: false,
    orderId: null
  },

  on: {
    submit: compose([
      (store) => {
        store.loading = true;
      },
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
        store.step = "submitted";
        store.loading = false;
      }
    ])
  }
});
```

Choose L2.5 when:

- A handler has ordered synchronous and async segments.
- Independent effects should start at the same ordered point.
- You want step-level `previous` values without introducing the L3 helper
  vocabulary.

## L3: Step Helpers

L3 adds reusable step helpers. These helpers are still ordinary Flow handler
functions, but common workflow wiring reads declaratively.

```js
import { after, branch, compose, dispatch, flow, set, status, when } from "@async/flow";

const job = flow({
  store: {
    step: status("SubmitJob", [
      "SubmitJob",
      "WaitForCompletion",
      "GetJobStatus",
      "JobSucceeded",
      "JobError"
    ]),
    jobStatus: undefined
  },

  on: {
    determineCompletion: compose([
      when((store) => store.step === "GetJobStatus"),
      branch([
        [(store) => store.jobStatus === "SUCCEEDED", dispatch("reportJobSucceeded")],
        [(store) => store.jobStatus === "ERROR", dispatch("reportJobError")],
        compose([
          set("step", "WaitForCompletion"),
          after(5000, "checkJobStatus")
        ])
      ])
    ])
  }
});
```

Choose L3 when:

- Several handlers share store-write, gate, branch, dispatch, or scheduling
  patterns.
- You want workflow code to read as reusable steps instead of one long handler.
- You need `set(...)` projections from dispatch input or previous compose
  results.
- You need `after(...)` to schedule follow-up events without writing a custom
  receiver function.

## Moving Up The Layers

Start with L1 for primitives, move to L2 when state changes have event names,
use L2.5 when one event has ordered or parallel work, and move to L3 when the
same workflow wiring repeats.

The only half-step is L2.5 because composition changes handler structure without
adding a new domain vocabulary. L1 does not need a half-step: definitions and
runtime primitives are part of the same primitive/store layer. L3 does not need
a half-step: new helpers should either stay as reusable steps or become a
separate domain package.
