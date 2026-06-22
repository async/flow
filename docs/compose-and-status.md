# Compose And Status Helpers

`compose(...)` creates a handler from ordered steps. It is exported from
`@async/flow/compose`.

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

## Step Contract

Each step receives:

```js
step(store, input, previous);
```

`store` is the Flow store proxy. `input` is the stable dispatch input.
`previous` starts as `undefined` and becomes the last non-`undefined` value
returned by an earlier step.

`compose` preserves the receiver for every step, so method-style helpers can use
`this.dispatch(...)`, `this.resources`, and other Flow receiver capabilities.

```js
const handler = compose([
  function load(store) {
    return this.resources.user.load(store.userId);
  },
  function cache(store, _input, user) {
    store.currentUser = user;
  }
]);
```

## Async Boundaries

If every step is synchronous, the composed handler returns synchronously. It
does not create a promise.

When a step returns a promise-like value, Flow flushes the current synchronous
batch and resumes the remaining steps in a fresh batch after the promise
settles. This makes loading states observable before async work completes.

```text
sync segment:
  loading = true
flush

async work resolves

continuation segment:
  orderId = order.id
  loading = false
flush
```

## Helper Steps

`set(key, value)` writes `store[key] = value`.

```js
set("loading", true);
set({ loading: false, error: null });
```

`update(key, fn)` writes a value derived from the current store value:

```js
update("count", (count) => count + 1);
```

`when(predicate)` stops the composed handler when the predicate returns false:

```js
compose([
  when((store) => store.canSubmit),
  set("loading", true)
]);
```

`onError(handle, handler)` maps sync throws and async rejections:

```js
onError(
  (error) => ({ error: error.message }),
  async () => {
    throw new Error("failed");
  }
);
```

Plain object handler results are applied as store updates by Flow dispatch.
When a composed step returns a plain object as service data instead of store
updates, map it to a primitive or write it into the store before the composed
handler finishes.

## Status Helpers

`status(initial, allowed?)` declares a writable finite status value.

```js
const order = flow({
  store: {
    step: status("shipping", ["shipping", "payment", "review"]),
    canGoNext: can("step", "next"),
    inReview: matches("step", "review")
  },

  on: {
    next: transition("step", {
      shipping: "payment",
      payment: "review"
    }),

    submit: guard(
      (store) => store.step === "review",
      set("submitted", true)
    )
  }
});
```

`transition(statusName, rules)` writes the next status when a rule matches.
Missing matches are no-ops.

`can(statusName, eventName)` computes whether a transition handler can move
from the current status.

`matches(statusName, value)` computes whether the current status matches a
value.

`guard(predicate, handler)` skips the handler when the predicate is false.

Live status refs carry the exported `STATUS` symbol, backed by
`Symbol.for("@async/flow.status")`.

Transition and guard metadata use public symbols:

```js
import { GUARD, STATUS, TRANSITION } from "@async/flow";
```
