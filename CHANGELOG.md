# Changelog

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
