# Changelog

## 0.6.0 - 2026-06-24

- Added explicit compose availability metadata with `AVAILABILITY`,
  `when(..., { availability: true })`, and leading-gate lifting into
  `can(...)`, `explain(...)`, and `describe()`.
- Removed the legacy lifecycle compatibility surface in favor of async signal names:
  `ASYNC_SIGNAL`, `ASYNC_SIGNAL_IMMEDIATE`, `asyncSignals`, and the
  `@async/flow/async-signal` subpath now own the lifecycle API.
- Removed the old compatibility aliases and subpath.
- Renamed public inspection metadata to
  `describe().asyncSignals`.

## 0.5.0 - 2026-06-23

- Added projected Flow instance store values, including direct `flow.name`
  reads and writes for public store entries.
- Added `_` store field support for internal async signal controllers, plus a
  non-enumerable `flow._` namespace for integration code.
- Added getter-backed computed store entries and direct computed receiver reads
  such as `this.count`.
- Added `bool(...)`, `every(...)`, `some(...)`, and `not(...)` helpers for
  composing boolean conditions across `when(...)`, `branch(...)`,
  `guard(...)`, and `transition(...)`.
- Renamed the async signal lifecycle guide around async signal terminology.

## 0.4.0 - 2026-06-22

- Added `asyncSignal(...)`, `defineAsyncSignal(...)`, and
  `createAsyncSignal(...)` as the primary async signal API.
- Added signal-like async signal refs with value reads, writable set/update,
  restore support, lifecycle status, reload, cancel, stale-run suppression, and
  native abort support.
- Added options-first callback arguments for computed values and async signal
  loaders, with Flow context exposed on the function receiver.
- Added public step helpers for derived store writes, branching, dispatching,
  and delayed follow-up events.
- Added the GitHub Pages documentation target and pipeline workflow support for
  publishing the package docs site.

## 0.3.0 - 2026-06-22

- Added `parallel(...)` for fan-out/fan-in effects inside composed handlers.
- Added `remember(...)` for explicit previous-value copies around scoped
  handler work.
- Added public `flow.describe()` metadata for store entries, async signals,
  handlers, transitions, and guards.
- Added event-scoped `flow.can(...)`, receiver `this.can(...)`, and computed
  `can(eventName)` availability checks.
- Added `flow.explain(...)` and receiver `this.explain(...)` for stable
  blocked-event reason data.

## 0.2.0 - 2026-06-22

- Added the L3 Flow API refresh around `store`, `status`, `asyncSignal`,
  `dispatch`, and `compose`.
- Added lazy and immediate async signals with `load`, `reload`, `cancel`, `set`,
  status, snapshots, and native abort-signal support.
- Added status-first workflow helpers for `transition`, `guard`, `can`, and
  `matches`, plus composed handler batching across async boundaries.
- Removed the runner subpath in favor of `@async/flow/compose`.
- Added package docs for L1 primitives, L2 Flow events, L3 workflow helpers,
  store unwrapping, signals, computed values, status refs, and async signals.

## 0.1.0 - 2026-06-22

- Added the initial `@async/flow` package with portable signal refs, computed
  values, async signal helpers, store-like signal authoring, snapshots,
  restore, subscriptions, handler functions, and scheduler controls.
- Added `@async/flow/run` plus helper pipelines for `set`, `update`, `when`,
  and `onError`.
- Added optional strict helpers for `state`, `guard`, `transition`, `can`, and
  `matches` without adding actor or statechart runtime semantics.
- Added import-safe definition and runtime subpaths for framework adapters.
- Added Async Pipeline release checks and package dry-run verification.
