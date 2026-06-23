# Async Signal Lifecycle

Use an async signal when a store value comes from async work and callers need
one place to inspect, reload, cancel, replace, snapshot, or restore that value.

```js
import { asyncSignal, flow } from "@async/flow";

const profile = flow({
  store: {
    userId: "1",
    _user: asyncSignal(async function () {
      const response = await fetch(`/api/users/${this.store.userId}`, {
        signal: this.signal
      });
      return response.json();
    }),
    get user() {
      return this._user.get();
    },
    get status() {
      return this._user.status;
    }
  },

  on: {
    loadUser() {
      return this.store._user.load();
    },

    reloadUser(store, userId) {
      store.userId = userId;
      return this.store._user.reload();
    },

    cancelUser(_store, reason) {
      return this.store._user.cancel(reason);
    }
  }
});

await profile.loadUser();

profile.user; // loaded user
profile.status; // "ready"
```

`asyncSignal(...)` creates a declaration for a Flow store. The live controller
is created when the store is mounted, so the declaration is safe to export from
a module.

## Choose Lazy Or Immediate

Async signals have one store shape:

- Async signals starting with `_` read as controllers through `store._name`.
- Public getters expose the current value or lifecycle flags.

Flow instances also expose internal controllers through the non-enumerable
`flow._` namespace for integration code.

Use lazy async signals when an event should decide when loading starts. Use
immediate async signals when the Flow should start loading as soon as it is
created and handlers mostly read the value.

## Lazy Async Signals

`asyncSignal(loader)` is lazy by default. It does not call the loader until
`load(...)` or `reload(...)` is called.

```js
const profile = flow({
  store: {
    userId: "1",
    _user: asyncSignal(async function () {
      const response = await fetch(`/api/users/${this.store.userId}`, {
        signal: this.signal
      });
      return response.json();
    }),
    get user() {
      return this._user.get();
    },
    get status() {
      return this._user.status;
    }
  },

  on: {
    loadUser() {
      return this.store._user.load();
    }
  }
});

profile.user; // undefined
profile.status; // "idle"

await profile.loadUser();

profile.user; // loaded user
profile.status; // "ready"
```

Lazy async signal handlers use `this.store._user.load()` because `profile.user`
is the current value.

## Immediate Async Signals

`asyncSignal({ immediate: true }, loader)` starts loading while the Flow is
being created. The public getter reads as the current value. The value is
usually `undefined` until the first load resolves.

```js
const app = flow({
  store: {
    _settings: asyncSignal({ immediate: true }, async function () {
      const response = await fetch("/api/settings", { signal: this.signal });
      return response.json();
    }),
    get settings() {
      return this._settings.get();
    },
    get status() {
      return this._settings.status;
    }
  },

  on: {
    reloadSettings() {
      return this.store._settings.reload();
    },

    setTheme(_store, theme) {
      return this.store._settings.set({ theme });
    }
  }
});

app.settings; // undefined while the first load is pending
app.status; // "loading"

await app._._settings.load();

app.settings; // loaded settings
app.status; // "ready"
```

Immediate async signal handlers use `this.store._settings` because
`app.settings` is the loaded value.

## Loader Receiver

Loaders read Flow store data through `this.store`. Flow context and lifecycle
tools are available through `this`.

```js
asyncSignal(async function () {
  const response = await fetch(`/api/users/${this.store.userId}`, {
    signal: this.signal
  });

  return {
    version: this.version,
    user: await response.json()
  };
});
```

Explicit `load(...args)` and `reload(...args)` calls are available for
positional user data. Function loaders read store data from `this.store` and can
use `this.signal`, `this.version`, and `this.args`.

## Controller API

Every live async signal controller exposes:

```js
controller.value;
controller.get();
controller.status; // "idle" | "loading" | "ready" | "error"
controller.loading;
controller.ready;
controller.error;
controller.version;
controller.load(...args);
controller.reload(...args);
controller.set(value);
controller.update(fn);
controller.cancel(reason);
controller.snapshot();
controller.restore(snapshot);
controller.subscribe(fn);
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

Use the controller when lifecycle state matters:

```js
profile._._user.set(nextUser);
```

This route keeps lifecycle state, cancellation, subscriptions, and snapshots on
the async signal controller. Use `this.store._user` inside Flow authoring and
`profile._._user` from integration code.
