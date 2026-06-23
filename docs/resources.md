# Resource Lifecycle

Use a resource when a store value comes from async work and callers need one
place to inspect, reload, cancel, replace, snapshot, or restore that value.

```js
import { flow, resource } from "@async/flow";

const profile = flow({
  store: {
    userId: "1",
    user: resource(async (store, { signal, input }) => {
      const id = input ?? store.userId;
      const response = await fetch(`/api/users/${id}`, { signal });
      return response.json();
    })
  },

  on: {
    loadUser(store) {
      return store.user.load();
    },

    reloadUser(store, userId) {
      return store.user.reload(userId);
    },

    cancelUser(store, reason) {
      return store.user.cancel(reason);
    }
  }
});

await profile.loadUser();

profile.store.user.status; // "ready"
profile.store.user.value; // loaded user
```

`resource(...)` creates a declaration for a Flow store. The live controller is
created when the store is mounted, so the declaration is safe to export from a
module.

## Choose Lazy Or Immediate

Resources have two store shapes:

- Lazy resources keep the controller in `store.name`.
- Immediate resources keep the current value in `store.name` and the controller
  in `resources.name`.

Prefer lazy resources when an event should decide when loading starts. Prefer
immediate resources when the Flow should start loading as soon as it is created
and handlers mostly read the value.

## Lazy Resources

`resource(loader)` is lazy by default. It does not call the loader until
`load(...)` or `reload(...)` is called.

```js
const profile = flow({
  store: {
    userId: "1",
    user: resource(async (store, { signal }) => {
      const response = await fetch(`/api/users/${store.userId}`, { signal });
      return response.json();
    })
  },

  on: {
    loadUser(store) {
      return store.user.load();
    }
  }
});

profile.store.user.status; // "idle"
profile.resources.user === profile.store.user; // true

await profile.loadUser();

profile.store.user.status; // "ready"
profile.store.user.value; // loaded user
```

Lazy resource handlers can use `store.user.load()` because `store.user` is the
controller.

## Immediate Resources

`resource({ immediate: true }, loader)` starts loading while the Flow is being
created. The store reads as the current value, not as the controller. The value
is usually `undefined` until the first load resolves.

```js
const app = flow({
  store: {
    settings: resource({ immediate: true }, async (_store, { signal }) => {
      const response = await fetch("/api/settings", { signal });
      return response.json();
    })
  },

  on: {
    reloadSettings() {
      return this.resources.settings.reload();
    },

    setTheme(_store, theme) {
      return this.resources.settings.set({ theme });
    }
  }
});

app.store.settings; // undefined while the first load is pending
app.resources.settings.status; // "loading"

await app.resources.settings.load();

app.store.settings; // loaded settings
app.resources.settings.status; // "ready"
```

Immediate resource handlers must use `this.resources.settings` because
`store.settings` is the loaded value.

## Loader Arguments

Loaders receive `(store, tools)`.

```js
resource(async (store, { signal, input, version }) => {
  const response = await fetch(`/api/users/${input ?? store.userId}`, {
    signal
  });

  return {
    version,
    user: await response.json()
  };
});
```

`store` is the Flow store proxy. `tools.signal` is a native `AbortSignal`.
`tools.input` is the value passed to `load(input)` or `reload(input)`.
`tools.version` is the version number for the run being started.

## Controller API

Every live resource controller exposes:

```js
resource.value;
resource.status; // "idle" | "loading" | "ready" | "error"
resource.loading;
resource.ready;
resource.error;
resource.version;
resource.load(input);
resource.reload(input);
resource.set(value);
resource.cancel(reason);
resource.snapshot();
resource.restore(snapshot);
resource.subscribe(fn);
```

`load(input)` starts work from `idle` or `error`. If a run is already loading,
it returns the in-flight promise. If the resource is already `ready`, it returns
the current value without calling the loader. Use `reload(input)` when a ready
resource should fetch again or use different input.

`reload(input)` starts a new run and aborts the previous in-flight run.
Completions from stale runs do not overwrite current resource state.

`set(value)` aborts any in-flight run, stores a ready value, clears the current
error, and increments the resource version.

`cancel(reason)` aborts only the current run. A resource without a value settles
to `idle`; a resource with a value settles to `ready`. If nothing is loading,
`cancel(...)` returns the current status.

`snapshot()` returns `{ value, status, error, version }`. `restore(snapshot)`
restores that shape. Passing a raw value to `restore(...)` is the same as
calling `set(value)`.

`subscribe(fn)` calls `fn(resource)` whenever the controller changes and returns
an unsubscribe function.

## Store Assignment

Do not assign over a resource in the store:

```js
profile.store.user = nextUser; // throws
```

Use the controller instead:

```js
profile.store.user.set(nextUser); // lazy resource
profile.resources.user.set(nextUser); // lazy or immediate resource
```

This keeps lifecycle state, cancellation, subscriptions, and snapshots on the
resource controller.
