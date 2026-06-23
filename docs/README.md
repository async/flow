# Flow Docs

`@async/flow` provides a small runtime for store state, event dispatch, async
signals, and ordered handler steps.

Use these docs when the README is too compact:

- [Layer Guide](layers.md): L1 signal/computed, async signal, and store
  examples;
  L2 Flow events; L2.5 composition; and L3 step helpers.
- [Signals, Computed, Async Signals, And Store](state-and-store.md): computed
  values, async signal controllers, and store unwrapping.
- [Async Signal Lifecycle](async-signals.md): lazy and immediate async signals, load,
  reload, cancel, manual value writes, and snapshots.
- [Compose And Status Helpers](compose-and-status.md): `compose`, `parallel`,
  `remember`, `set`, `update`, `when`, `after`, `branch`, `dispatch`,
  `onError`, `status`, `transition`, `guard`, `bool`, `every`, `some`,
  `not`, `can`, `explain`, `describe`, and `matches`.

## API Layers

The package has four public layers:

The root `@async/flow` entrypoint exports the complete opinionated surface.
Subpaths remain available when a consumer wants a narrower entrypoint.

```js
import {
  after,
  asyncSignal,
  bool,
  branch,
  compose,
  createAsyncSignal,
  createFlow,
  createStore,
  defineAsyncSignal,
  defineFlow,
  dispatch,
  every,
  flow,
  not,
  parallel,
  remember,
  set,
  some,
  status,
  transition,
  when
} from "@async/flow";
```

Top-level `flow(...)` creates a live standalone Flow instance. Definition
helpers are import-safe and do not create shared live state at module load time.

## Current Names

Use the current names in new code:

```text
signals       -> store
state(...)    -> status(...)
flow.run      -> flow.dispatch
run([...])    -> compose([...])
@async/flow/run -> root compose(...) or @async/flow/compose
```
