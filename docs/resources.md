# Resource Lifecycle

Resources are signal-backed async values with explicit lifecycle controls.

```js
import { flow, resource } from "@async/flow";

const profile = flow({
  store: {
    userId: "1",
    user: resource(async (store, { signal, input, version }) => {
      const response = await fetch(`/api/users/${input ?? store.userId}`, {
        signal
      });

      return {
        version,
        user: await response.json()
      };
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
```

## Lazy Resources

`resource(loader)` is lazy by default. It stays as a controller object in the
store:

```js
profile.store.user.status; // "idle"
profile.store.user.loading; // false

await profile.dispatch("loadUser");

profile.store.user.status; // "ready"
profile.store.user.value; // loaded value
```

Lazy resources expose the same controller through `flow.resources.name`:

```js
profile.resources.user === profile.store.user; // true
```

## Immediate Resources

`resource({ immediate: true }, loader)` starts when the Flow is created and
reads as a value from the store. Its controller remains available through
`flow.resources.name` and `this.resources.name`.

```js
const app = flow({
  store: {
    settings: resource({ immediate: true }, async () => {
      return { theme: "dark" };
    })
  },

  on: {
    reloadSettings() {
      return this.resources.settings.reload();
    }
  }
});

app.store.settings; // current value
app.resources.settings.status; // lifecycle status
```

## Controller API

Every resource controller exposes:

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

`load(input)` starts work from `idle` or `error`, returns the in-flight promise
while already loading, and returns the current value when ready.

`reload(input)` starts a new run and aborts the previous in-flight run.
Completions from stale runs do not overwrite current resource state.

`set(value)` writes a ready value without running the loader.

`cancel(reason)` aborts only the current run. A resource without a value settles
to `idle`; a resource with a value settles to `ready`.

## Store Assignment

Do not assign over a resource in the store:

```js
profile.store.user = nextUser; // throws
```

Use the controller instead:

```js
profile.store.user.set(nextUser);
profile.resources.user.set(nextUser);
```

This keeps async side effects, cache writes, cancellation, and snapshots on the
resource controller.
