# Async Signal Lifecycle

Use an async signal when a store value comes from async work and callers need
one place to inspect, reload, cancel, replace, snapshot, or restore that value.

```js
import { asyncSignal, flow } from "@async/flow";

const profile = flow({
  store: {
    userId: "1",
    user: asyncSignal({ arguments: (store) => [store.userId] }, async function (userId) {
      const response = await fetch(`/api/users/${userId}`, { signal: this.signal });
      return response.json();
    })
  },

  on: {
    loadUser() {
      return this.refs.user.load();
    },

    reloadUser(_store, userId) {
      return this.refs.user.reload(userId);
    },

    cancelUser(_store, reason) {
      return this.refs.user.cancel(reason);
    }
  }
});

await profile.loadUser();

profile.store.user; // loaded user
profile.refs.user.status; // "ready"
```

`asyncSignal(...)` creates a declaration for a Flow store. The live controller
is created when the store is mounted, so the declaration is safe to export from
a module.

## Choose Lazy Or Immediate

Async signals have one store shape:

- Lazy and immediate async signals read as current values through `store.name`.
- Controllers live under `refs.name`.
- `resources.name` remains a compatibility view of the same controller.

Prefer lazy async signals when an event should decide when loading starts.
Prefer immediate async signals when the Flow should start loading as soon as it
is created and handlers mostly read the value.

## Lazy Async Signals

`asyncSignal(loader)` is lazy by default. It does not call the loader until
`load(...)` or `reload(...)` is called.

```js
const profile = flow({
  store: {
    userId: "1",
    user: asyncSignal({ arguments: (store) => [store.userId] }, async function (userId) {
      const response = await fetch(`/api/users/${userId}`, { signal: this.signal });
      return response.json();
    })
  },

  on: {
    loadUser() {
      return this.refs.user.load();
    }
  }
});

profile.store.user; // undefined
profile.refs.user.status; // "idle"
profile.resources.user === profile.refs.user; // true

await profile.loadUser();

profile.store.user; // loaded user
profile.refs.user.status; // "ready"
```

Lazy async signal handlers use `this.refs.user.load()` because `store.user` is
the current value.

## Immediate Async Signals

`asyncSignal({ immediate: true }, loader)` starts loading while the Flow is
being created. The store reads as the current value. The value is usually
`undefined` until the first load resolves.

```js
const app = flow({
  store: {
    settings: asyncSignal({ immediate: true }, async function () {
      const response = await fetch("/api/settings", { signal: this.signal });
      return response.json();
    })
  },

  on: {
    reloadSettings() {
      return this.refs.settings.reload();
    },

    setTheme(_store, theme) {
      return this.refs.settings.set({ theme });
    }
  }
});

app.store.settings; // undefined while the first load is pending
app.refs.settings.status; // "loading"

await app.refs.settings.load();

app.store.settings; // loaded settings
app.refs.settings.status; // "ready"
```

Immediate async signal handlers must use `this.refs.settings` because
`store.settings` is the loaded value.

## Loader Arguments

Loaders receive only user positional arguments. Flow context and lifecycle tools
are available through `this`.

```js
asyncSignal({ arguments: (store) => [store.userId] }, async function (userId) {
  const response = await fetch(`/api/users/${userId}`, {
    signal: this.signal
  });

  return {
    version: this.version,
    user: await response.json()
  };
});
```

`options.arguments` may be an array or a function that returns an array.
Explicit `load(...args)` and `reload(...args)` calls override configured
arguments. Function loaders can read `this.store`, `this.refs`,
`this.resources`, `this.name`, `this.signal`, `this.version`, and `this.args`.

## Controller API

Every live async signal controller exposes:

```js
ref.value;
ref.get();
ref.status; // "idle" | "loading" | "ready" | "error"
ref.loading;
ref.ready;
ref.error;
ref.version;
ref.load(...args);
ref.reload(...args);
ref.set(value);
ref.update(fn);
ref.cancel(reason);
ref.snapshot();
ref.restore(snapshot);
ref.subscribe(fn);
```

`load(...args)` starts work from `idle` or `error`. If a run is already loading,
it returns the in-flight promise. If the async signal is already `ready`, it
returns the current value without calling the loader. Explicit arguments are
passed to the loader and override configured `options.arguments`. Use
`reload(...args)` when a ready async signal should fetch again or use different
arguments.

`reload(...args)` starts a new run and aborts the previous in-flight run.
Completions from stale runs do not overwrite current async signal state.

`set(value)` aborts any in-flight run, stores a ready value, clears the current
error, and increments the async signal version.

`cancel(reason)` aborts only the current run. An async signal without a value
settles to `idle`; an async signal with a value settles to `ready`. If nothing
is loading, `cancel(...)` returns the current status.

`snapshot()` returns `{ value, status, error, version }`. `restore(snapshot)`
restores that shape. Passing a raw value to `restore(...)` is the same as
calling `set(value)`.

`subscribe(fn)` calls `fn(value)` whenever the controller changes and returns an
unsubscribe function.

## Store Assignment

Assigning through the store writes the current async signal value:

```js
profile.store.user = nextUser;
```

Use the controller when lifecycle state matters:

```js
profile.refs.user.set(nextUser);
profile.resources.user.set(nextUser); // compatibility view
```

Both routes keep lifecycle state, cancellation, subscriptions, and snapshots on
the async signal controller.
