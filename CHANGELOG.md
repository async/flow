# Changelog

## Unreleased

## 0.10.3 - 2026-07-02

### Changed

- Replaced the duplicated `/helpers` and `/helpers/core` implementations with
  shared helper construction while preserving each subpath's scheduler
  behavior.

## 0.10.2 - 2026-07-02

### Fixed

- Kept public Flow ref views from exposing mutation wrappers for read-only
  computed refs so Framework and other consumers can reliably detect writable
  refs.

## 0.10.1 - 2026-07-02

### Fixed

- Replaced Flow dispatch batching with dispatch-scoped batching so direct
  mutations after awaited handlers stay attributed to the dispatch that owns
  them, including concurrent dispatches.
- Made whole-flow subscribers receive one named committed-state record after a
  dispatch settles, including mutate-then-reject handlers.
- Made `destroy()` terminal and idempotent for Flow instance APIs, public refs,
  async signals, subscriptions, timers, and Flow-owned async work while keeping
  final-state reads available.
- Prevented unhandled process failures from immediate async-signal loaders,
  timer-driven dispatches, standalone `after(...)` tasks, abandoned
  `parallel(...)` branch promises, and throwing scheduled subscribers.
- Made async-signal restore cancel in-flight loads before applying hydrated
  state.
- Adopted live signal and status refs declared in stores instead of copying
  them into split-brain Flow-owned refs.
- Preserved composed transition and guard metadata so `can(...)`,
  `explain(...)`, builder output, and graph inspection stay truthful.

### Changed

- Added strict TypeScript consumer checks to `typecheck` for root and exported
  subpaths.
- Added a helpers parity guard for `@async/flow/helpers` and
  `@async/flow/helpers/core`.
- Documented stable public subpaths and removed `explain` from importable
  helper lists.

## 0.10.0 - 2026-06-26

### Added

- Added `@async/flow/protocol` as the shared symbol-brand subpath for Flow
  definitions, live instances, helper metadata, compose batching, and graph
  objects.

### Changed

- Made `@async/flow/graph` consume Flow instances through the `FLOW_INSPECT`
  protocol symbol instead of importing helper APIs.
- Made `@async/flow/builder` compile through the scheduler-free helper layer so
  graph-to-config compilation does not pull in the default scheduler wrapper.

## 0.9.0 - 2026-06-26

### Added

- Added scheduler-free integration subpaths for framework adapters:
  `@async/flow/framework-runtime` and `@async/flow/helpers/core`.

## 0.8.0 - 2026-06-25

### Breaking Changes

- Whole-flow subscribers now receive full public store snapshots in
  `change.store` instead of sparse changed-key patches.

### Added

- Added the opt-in `@async/flow/graph` subpath with `toGraph(...)` and
  `toMermaid(...)` for runtime graph metadata and Mermaid state diagrams.
- Added the opt-in `@async/flow/builder` subpath with `toFlowConfig(...)` for
  compiling declarative `store` plus `on` graphs into ordinary Flow config.
- Added builder support for named handler registries, external signal guards,
  transitions, handlers, set, dispatch, after, and parallel steps.
- Documented projected handler methods and target-first dispatch as the
  preferred authoring model for known events and dynamic routing.

## 0.7.0 - 2026-06-24

### Breaking Changes

- `status(...)` now creates a live signal-based status ref. Use
  `defineStatus(...)` when a pure declaration object is required.
- Removed the root `statusHelper` export.
- Removed `status` from `@async/flow/define`; use `defineStatus(...)`.
- Removed Flow instance and receiver availability methods. Use imported
  `can(flow, eventName).get()` or `can(receiver, eventName).get()`.
- Removed Flow instance and receiver description methods. Use imported
  `inspect(flow)` or `inspect(receiver)`.
- Removed private `_describe` receiver metadata. Helper inspection and status
  inference now use the `FLOW_INSPECT` symbol.
- Renamed public metadata and ref discriminator fields from `kind` to `type`.
- `transition("name", rules)` now requires a Flow store argument or
  symbol-branded Flow receiver. It no longer falls back to any object with a
  `store` property.
- Standalone transitions are now branded with
  `STANDALONE_TRANSITION = Symbol.for("@async/flow.standaloneTransition")`.
- `after(ms, callback, input?)` now creates a standalone cancellable timer
  helper branded with `STANDALONE_AFTER =
  Symbol.for("@async/flow.standaloneAfter")`.
- `dispatch("event", payload?)` now creates a proxy-backed reusable sender
  branded with `STANDALONE_DISPATCH =
  Symbol.for("@async/flow.standaloneDispatch")`.
- `dispatch(target, "event", payload?)` now dispatches immediately to Flow,
  DOM, emitter, and sender-style targets.
- `can(...)`, `matches(...)`, `set(...)`, `update(...)`, `dispatch(...)`, and
  boolean helpers now prefer live ref behavior when passed signal, status,
  computed, Flow, or standalone refs.

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
