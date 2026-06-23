# Compose And Status Helpers

`compose(...)` creates a handler from ordered steps.

```js
import {
  after,
  branch,
  compose,
  dispatch,
  flow,
  parallel,
  remember,
  set,
  status,
  transition,
  when
} from "@async/flow";

const checkout = flow({
  store: {
    step: status("shipping", ["shipping", "payment", "review"]),
    previousStep: null,
    canSubmit: true,
    loading: false,
    orderId: null
  },

  on: {
    next: remember(["step", "previousStep"], [
      transition("step", {
        shipping: "payment",
        payment: "review"
      })
    ]),

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

## Step Contract

Each step receives:

```js
step(store, input, previous);
```

`store` is the Flow store proxy. `input` is the stable dispatch input.
`previous` starts as `undefined` and becomes the last non-`undefined` value
returned by an earlier step.

`compose` preserves the receiver for every step, so method-style helpers can use
`this.dispatch(...)`, `this.refs`, and other Flow receiver capabilities.

```js
const handler = compose([
  function load(store) {
    return this.refs.user.load(store.userId);
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

Values may also be derived from the current store, dispatch input, or previous
compose result:

```js
set("orderId", (_store, _input, order) => order.id);
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

`dispatch(eventName, input?)` forwards to another Flow event. `input` may be a
plain value or a function that receives `(store, input, previous)`.

```js
dispatch("finish", (_store, input) => ({ source: input.source }));
```

`after(ms, eventName, input?)` schedules another Flow event through the current
Flow receiver.

```js
after(5000, "checkJobStatus", (store) => ({ id: store.jobId }));
```

`branch(cases)` runs the first matching case. Tuple cases are
`[predicate, handler]`; a bare handler is the default case.

```js
branch([
  [(store) => store.jobStatus === "SUCCEEDED", dispatch("reportJobSucceeded")],
  [(store) => store.jobStatus === "ERROR", dispatch("reportJobError")],
  compose([
    set("step", "WaitForCompletion"),
    after(5000, "checkJobStatus")
  ])
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

`parallel(branches)` runs independent branch steps at the same point in a
composed handler, waits for every async branch, and returns `undefined`.

```js
compose([
  set({ refreshing: true, error: null }),
  parallel({
    user() {
      return this.refs.user.reload();
    },
    cart() {
      return this.refs.cart.reload();
    }
  }),
  set("refreshing", false)
]);
```

Use `parallel(...)` for effect fan-out/fan-in. It does not create parallel
state regions and it does not collect branch results by default.

`remember(mapping, steps)` captures source store values before scoped work and
writes those captured values to explicit target fields after the scoped work
succeeds, but only when a source changed.

```js
remember(["step", "previousStep"], [
  transition("step", {
    shipping: "payment",
    payment: "review"
  })
]);
```

Multiple mappings are supported:

```js
remember([
  ["step", "previousStep"],
  ["mode", "previousMode"]
], [
  transition("step", { shipping: "payment" }),
  set("mode", "editing")
]);
```

`remember(...)` stores previous values in author-chosen fields. It does not add
hidden history, rollback, or transaction behavior.

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

`can(eventName)` computes whether an event is available now. It infers the
status metadata from the event instead of repeating the status name.

```js
const checkout = flow({
  store: {
    step: status("shipping", ["shipping", "payment", "review"]),
    canAdvance: can("next")
  },
  on: {
    next: transition("step", {
      shipping: "payment",
      payment: "review"
    })
  }
});
```

`matches(statusName, value)` computes whether the current status matches a
value.

`guard(predicate, handler)` skips the handler when the predicate is false.

`flow.can(eventName, input?)` and receiver `this.can(eventName, input?)` return
the same event availability boolean without dispatching the event.

```js
checkout.can("next"); // true
checkout.can("submit", { confirm: true });
```

`flow.explain(eventName, input?)` and receiver
`this.explain(eventName, input?)` return stable reason data for allowed and
blocked events. Applications should map reason codes to user-facing text.

```js
checkout.explain("submit");
// {
//   event: "submit",
//   allowed: false,
//   reason: "guard_failed",
//   source: "guard"
// }
```

Built-in reason codes are:

```text
unknown_event
allowed
plain_handler
no_matching_transition
transition_condition_failed
guard_failed
```

Transition rules and guards may carry `reason` and `label` metadata:

```js
guard(
  (store) => store.step === "review" && store.canSubmit,
  transition("step", { review: "submitted" }),
  {
    reason: "cannot_submit",
    label: "Submit order"
  }
);
```

`flow.describe()` and receiver `this.describe()` return public inspection data
for store entries, resources, handlers, transitions, and guards.

```js
const description = checkout.describe();

description.handlers; // ["next", "submit"]
description.store.step.kind; // "status"
description.transitions.next.status; // "step"
```

Descriptions are fresh snapshots for inspection. They do not expose raw handler
functions, guard predicates, or transition condition functions.

Live status refs carry the exported `STATUS` symbol, backed by
`Symbol.for("@async/flow.status")`.

Transition and guard metadata use public symbols:

```js
import { GUARD, STATUS, TRANSITION } from "@async/flow";
```
