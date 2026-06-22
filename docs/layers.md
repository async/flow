# Layer Guide

`@async/flow` is built in layers. Each higher layer keeps the lower layer
available, but adds a more opinionated authoring shape.

Use the lowest layer that keeps the code clear. Move higher when the repeated
patterns become part of the application design instead of local state mechanics.

## L1: Primitives And Store

L1 is the live runtime layer:

- `createSignal(initial)`: writable ref with `get`, `set`, `update`, and
  `subscribe`.
- `createComputed(fn)`: derived read-only ref.
- `createResource(loader)`: async value controller with `load`, `reload`,
  `cancel`, `set`, status, snapshots, and subscriptions.
- `createStore(shape)`: store proxy plus raw `refs` and `resources`.

```js
import { computed, status } from "@async/flow";
import { createStore } from "@async/flow/runtime";

const state = createStore({
  count: 0,
  doubled: computed((store) => store.count * 2),
  phase: status("idle", ["idle", "ready"])
});

state.store.count += 1;
state.store.doubled; // 2
state.refs.phase.set("ready");
```

Choose L1 when:

- You are integrating Flow state into another runtime or framework.
- You need direct refs or resource controllers.
- There is no useful event vocabulary yet.
- Tests or adapters need small state units without a full Flow instance.

## L2: Flow Events

L2 adds named events, handler batching, snapshots, receiver capabilities, and a
single author-facing `store`.

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
    }
  }
});

counter.dispatch("increment", { by: 2 });
```

Choose L2 when:

- State changes should be named actions such as `increment`, `fetch`, or
  `submit`.
- Subscribers should see batched handler changes.
- Handlers need `this.dispatch(...)`, `this.after(...)`, `this.resources`, or
  injected runtime context.
- The code needs a stable public surface for adapters or framework wrappers.

## L3: Workflow Helpers

L3 adds small workflow helpers over ordinary Flow handlers. It is not a
statechart runtime. The helpers keep the same store-first shape and can be mixed
with handwritten handlers.

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
        const order = await saveOrder(input);
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

Choose L3 when:

- Several handlers share the same step pattern.
- A finite status value drives user-visible workflow state.
- Async work needs a synchronous loading segment before promise resolution.
- The workflow should read as small reusable steps instead of one long handler.

## Moving Up The Layers

Start with L1 for primitives, move to L2 when the state has events, and move to
L3 when those events have repeatable workflow structure.

Higher layers should remove repeated wiring. They should not hide important
state ownership. `store`, `refs`, and `resources` remain visible so adapters can
drop back down a layer when they need direct control.
