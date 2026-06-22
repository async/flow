# Flow Docs

`@async/flow` provides a small runtime for store state, event dispatch,
resources, and ordered handler steps.

Use these docs when the README is too compact:

- [Layer Guide](layers.md): L1 primitives, L2 Flow events, and L3 workflow
  helpers.
- [Signals, Computed, Resources, And Store](state-and-store.md): direct refs,
  computed values, resource controllers, and store unwrapping.
- [Resource Lifecycle](resources.md): lazy and immediate resources, load,
  reload, cancel, cache writes, and snapshots.
- [Compose And Status Helpers](compose-and-status.md): `compose`, `set`,
  `update`, `when`, `onError`, `status`, `transition`, `guard`, `can`, and
  `matches`.

## API Layers

The package has three public layers:

- L1 live primitives and store constructors from `@async/flow/runtime`.
- L2 import-safe declarations from `@async/flow/define` and live Flow instances
  from top-level `flow(...)`.
- L3 workflow helpers such as `compose`, `set`, `transition`, and `guard`.

```js
import { compose, flow, resource, status, transition } from "@async/flow";
import { defineFlow, defineResource } from "@async/flow/define";
import { createFlow, createResource, createStore } from "@async/flow/runtime";
```

Top-level `flow(...)` creates a live standalone Flow instance. Definition
helpers are import-safe and do not create shared live state at module load time.

## Removed Public Names

Use the current names in new code:

```text
signals       -> store
state(...)    -> status(...)
asyncSignal   -> resource(...)
flow.run      -> flow.dispatch
run([...])    -> compose([...])
@async/flow/run -> @async/flow/compose
refresh       -> reload
```

The removed names are not compatibility surfaces.
