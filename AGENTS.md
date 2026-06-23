# @async/flow Agent Guide

This file adds repo-specific rules for the `@async/flow` checkout. The root
workspace `AGENTS.md` still applies.

## Repo Shape

- Work from this repository checkout and check `git status --short --branch`
  before editing.
- This package is `@async/flow`: a portable signal state and handler runtime
  that can run standalone or be mounted by `@async/framework`.
- Use Node.js 24 or newer and pnpm. Keep the package ESM-only with `.js`
  source files and explicit `.js` import extensions.
- Main source lives in `src/`; tests live in `tests/*.test.js`.

## Runtime Boundaries

- Top-level `flow(...)` creates a live standalone Flow instance.
- Definition helpers in `@async/flow/define` must not create shared live state
  at import time.
- `@async/flow/run` is not a public subpath. Use `compose([...])` for ordered
  handler pipelines.
- The root `@async/flow` entrypoint exports the complete opinionated public
  surface. Framework integrations may still prefer explicit subpaths when they
  need a narrower primitive surface.

## Public API Rules

- Preserve the author-facing store shape: `store.name` reads values and
  `store.name = next` writes writable values.
- Preserve raw refs separately as `refs.name.get()`, `refs.name.set(...)`, and
  `refs.name.value`.
- Direct arrays in `on` are invalid. Use `compose([...])` to create a handler
  function.
- Plain record signal values are invalid unless wrapped in `signal(value)`.
- Do not add actor, spawned child, full statechart, parallel-state, history, or
  visual-tooling semantics to core Flow.

## Verification

- Focused package check: `pnpm test`.
- Export and syntax check: `pnpm run typecheck`.
- Package dry-run check: `pnpm run pack:check`.
- For docs or public wording changes, run the root workspace leakage scan before
  finishing.
