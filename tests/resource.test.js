import assert from "node:assert/strict";
import test from "node:test";
import {
  RESOURCE,
  RESOURCE_IMMEDIATE,
  asyncSignal,
  createAsyncSignal,
  createResource,
  defineAsyncSignal,
  defineResource,
  flow,
  isImmediateResource,
  isResource,
  resource
} from "@async/flow";

test("asyncSignal and compatibility resource names create import-safe declarations", () => {
  const loader = async () => "hello";
  const greeting = asyncSignal(loader);
  const profile = defineAsyncSignal({ immediate: true }, loader);
  const compatibility = resource(loader);
  const explicitCompatibility = defineResource(loader);

  assert.equal(greeting[RESOURCE], true);
  assert.equal(greeting[RESOURCE_IMMEDIATE], undefined);
  assert.equal(greeting.loader, loader);
  assert.equal(greeting.options.immediate, false);
  assert.equal(profile[RESOURCE], true);
  assert.equal(profile[RESOURCE_IMMEDIATE], true);
  assert.equal(compatibility[RESOURCE], true);
  assert.equal(explicitCompatibility[RESOURCE], true);
  assert.equal(isResource(greeting), true);
  assert.equal(isImmediateResource(greeting), false);
  assert.equal(isImmediateResource(profile), true);
});

test("createAsyncSignal is lazy by default and loads from idle loading ready and error", async () => {
  let calls = 0;
  const first = deferred();
  const seen = [];
  const api = createAsyncSignal(async function (...args) {
    calls += 1;
    seen.push({
      args,
      signal: this.signal,
      version: this.version
    });
    if (args[0] === "fail") {
      throw new Error("failed");
    }
    return first.promise;
  });

  assert.equal(api.status, "idle");
  assert.equal(api.loading, false);

  const pending = api.load("first");
  assert.equal(api.status, "loading");
  assert.equal(api.load(), pending);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(seen.map(({ args, version }) => ({ args, version })), [
    { args: ["first"], version: 1 }
  ]);
  assert.equal(seen[0].signal instanceof AbortSignal, true);

  first.resolve("hello");
  assert.equal(await pending, "hello");
  assert.equal(api.status, "ready");
  assert.equal(api.ready, true);
  assert.equal(api.get(), "hello");
  assert.equal(api.value, "hello");
  assert.equal(api.load(), "hello");

  const failing = createAsyncSignal(async function (input) {
    calls += 1;
    if (input === "fail") {
      throw new Error("failed");
    }
    return "recovered";
  });

  await assert.rejects(() => failing.load("fail"), /failed/);
  assert.equal(failing.status, "error");
  assert.match(String(failing.error), /failed/);
  assert.equal(await failing.load("ok"), "recovered");
  assert.equal(failing.status, "ready");
});

test("reload aborts current work and stale completions do not overwrite state", async () => {
  const runs = [];
  const api = createAsyncSignal(async function (...args) {
    const run = deferred();
    runs.push({
      args,
      signal: this.signal,
      version: this.version,
      ...run
    });
    return run.promise;
  });

  const first = api.reload("first");
  assert.equal(api.status, "loading");
  await Promise.resolve();
  assert.equal(runs.length, 1);

  const second = api.reload("second");
  assert.equal(runs[0].signal.aborted, true);
  assert.equal(api.status, "loading");
  await Promise.resolve();
  assert.equal(runs.length, 2);

  runs[0].resolve("stale");
  assert.equal(await first, "stale");
  assert.equal(api.status, "loading");
  assert.equal(api.value, undefined);

  runs[1].resolve("fresh");
  assert.equal(await second, "fresh");
  assert.equal(api.status, "ready");
  assert.equal(api.value, "fresh");
  assert.deepEqual(runs.map(({ args, version }) => ({ args, version })), [
    { args: ["first"], version: 1 },
    { args: ["second"], version: 2 }
  ]);
});

test("set updates resource value without running the loader", () => {
  let calls = 0;
  const api = createAsyncSignal(async () => {
    calls += 1;
    return "loaded";
  });

  assert.equal(api.set("manual"), "manual");
  assert.equal(api.update((value) => `${value}!`), "manual!");
  assert.equal(api.value, "manual!");
  assert.equal(api.get(), "manual!");
  assert.equal(api.status, "ready");
  assert.equal(calls, 0);
});

test("cancel settles to idle without value and ready with value", async () => {
  const emptyRun = deferred();
  const empty = createAsyncSignal(async function () {
    if (this.signal.aborted) {
      throw toAbortError();
    }
    this.signal.addEventListener("abort", () => emptyRun.reject(toAbortError()));
    return emptyRun.promise;
  });

  const emptyPromise = empty.load();
  assert.equal(empty.cancel("stop"), "idle");
  assert.equal(empty.status, "idle");
  await assert.rejects(() => emptyPromise, /aborted/);

  const loadedRun = deferred();
  const loaded = createAsyncSignal(async function () {
    if (this.signal.aborted) {
      throw toAbortError();
    }
    this.signal.addEventListener("abort", () => loadedRun.reject(toAbortError()));
    return loadedRun.promise;
  });

  loaded.set("cached");
  const loadedPromise = loaded.reload();
  assert.equal(loaded.cancel(), "ready");
  assert.equal(loaded.value, "cached");
  assert.equal(loaded.status, "ready");
  await assert.rejects(() => loadedPromise, /aborted/);
});

test("loaders receive configured explicit args and receiver context", async () => {
  const seen = [];
  const api = createAsyncSignal({ arguments: ["default"] }, async function (...args) {
    seen.push({
      args,
      store: this.store,
      signal: this.signal,
      version: this.version,
      receiverArgs: this.args
    });
    return args.join(":");
  });

  assert.equal(await api.load(), "default");
  assert.equal(await api.reload("override"), "override");
  assert.equal(seen[0].signal instanceof AbortSignal, true);
  assert.deepEqual(seen.map(({ args, store, version, receiverArgs }) => ({ args, store, version, receiverArgs })), [
    { args: ["default"], store: undefined, version: 1, receiverArgs: ["default"] },
    { args: ["override"], store: undefined, version: 2, receiverArgs: ["override"] }
  ]);
});

test("lazy async signals read as values in store and expose controllers through refs and resources", async () => {
  const greetingFlow = flow({
    store: {
      name: "World",
      greeting: asyncSignal(async function () {
        const name = this.store.name;
        assert.equal(this.signal instanceof AbortSignal, true);
        assert.equal(this.refs.greeting, this.resources.greeting);
        assert.equal(this.name, "greeting");
        return `Hello ${name}`;
      })
    },
    on: {
      fetch() {
        return this.resources.greeting.load();
      },
      retry() {
        return this.resources.greeting.reload();
      },
      replace(store, input) {
        store.greeting = input.value;
        return store.greeting;
      },
      cancel(store) {
        return this.resources.greeting.cancel();
      }
    }
  });

  assert.equal(greetingFlow.store.greeting, undefined);
  assert.equal(greetingFlow.refs.greeting.kind, "asyncSignal");
  assert.equal(greetingFlow.resources.greeting, greetingFlow.refs.greeting);
  assert.equal(await greetingFlow.fetch(), "Hello World");
  assert.equal(greetingFlow.store.greeting, "Hello World");
  assert.equal(await greetingFlow.retry(), "Hello World");
  assert.equal(greetingFlow.replace({ value: "Hi World" }), "Hi World");
  assert.equal(greetingFlow.cancel(), "ready");
  greetingFlow.store.greeting = "direct";
  assert.equal(greetingFlow.refs.greeting.get(), "direct");
});

test("underscore async signals expose internal controllers through store and namespace", async () => {
  const greetingFlow = flow({
    store: {
      name: "World",
      _request: asyncSignal(async function () {
        return `Hello ${this.store.name}`;
      }),
      get status() {
        return this._request.status;
      },
      get value() {
        return this._request.get();
      }
    },
    on: {
      fetch() {
        return this.store._request.load();
      },
      retry() {
        return this.store._request.reload();
      },
      replace(_store, input) {
        return this.store._request.set(input.value);
      },
      cancel(_store, reason) {
        return this.store._request.cancel(reason);
      }
    }
  });

  assert.equal(Object.hasOwn(greetingFlow, "_request"), false);
  assert.equal(Object.keys(greetingFlow).includes("_"), false);
  assert.equal(greetingFlow._._request, greetingFlow.store._request);
  assert.equal(greetingFlow.store._request.status, "idle");
  assert.equal(greetingFlow.status, "idle");
  assert.equal(greetingFlow.value, undefined);
  assert.equal(await greetingFlow.fetch(), "Hello World");
  assert.equal(greetingFlow.store._request.status, "ready");
  assert.equal(greetingFlow.store._request.get(), "Hello World");
  assert.equal(greetingFlow.status, "ready");
  assert.equal(greetingFlow.value, "Hello World");
  assert.equal(await greetingFlow.retry(), "Hello World");
  assert.equal(greetingFlow.replace({ value: "Hi World" }), "Hi World");
  assert.equal(greetingFlow.cancel("stop"), "ready");
});

test("async signal lifecycle getters track computed store values", async () => {
  const runs = [];
  const profile = flow({
    store: {
      _request: asyncSignal(async function () {
        const run = deferred();
        runs.push(run);
        return run.promise;
      }),
      get status() {
        return this._request.status;
      },
      get value() {
        return this._request.get();
      }
    },
    on: {
      load() {
        return this.store._request.load();
      },
      reload() {
        return this.store._request.reload();
      },
      replace(_store, value) {
        return this.store._request.set(value);
      }
    }
  });
  const statuses = [];
  const values = [];

  profile.subscribe("status", (value) => statuses.push(value));
  profile.subscribe("value", (value) => values.push(value));

  const first = profile.load();
  assert.equal(profile.status, "loading");
  assert.deepEqual(statuses, ["loading"]);
  await Promise.resolve();
  runs[0].resolve("Ada");
  assert.equal(await first, "Ada");
  assert.equal(profile.status, "ready");
  assert.equal(profile.value, "Ada");
  assert.deepEqual(statuses, ["loading", "ready"]);
  assert.deepEqual(values, ["Ada"]);

  const second = profile.reload();
  assert.equal(profile.status, "loading");
  await Promise.resolve();
  runs[1].reject(new Error("failed"));
  await assert.rejects(() => second, /failed/);
  assert.equal(profile.status, "error");
  assert.equal(profile.value, "Ada");
  assert.deepEqual(statuses, ["loading", "ready", "loading", "error"]);
  assert.deepEqual(values, ["Ada"]);

  assert.equal(profile.replace("Grace"), "Grace");
  assert.equal(profile.status, "ready");
  assert.equal(profile.value, "Grace");
  assert.deepEqual(statuses, ["loading", "ready", "loading", "error", "ready"]);
  assert.deepEqual(values, ["Ada", "Grace"]);
});

test("immediate async signals are value-like in store and controller-like through refs and resources", async () => {
  let calls = 0;
  const profile = flow({
    store: {
      user: asyncSignal({ immediate: true }, async () => {
        calls += 1;
        return `Ada ${calls}`;
      })
    },
    on: {
      refreshUser() {
        return this.refs.user.reload();
      },
      setUser(_store, input) {
        return this.resources.user.set(input.name);
      }
    }
  });

  assert.equal(profile.refs.user, profile.resources.user);
  assert.equal(profile.refs.user.status, "loading");
  assert.equal(profile.store.user, undefined);
  assert.equal(await profile.refs.user.load(), "Ada 1");
  assert.equal(profile.store.user, "Ada 1");
  assert.equal(await profile.refreshUser(), "Ada 2");
  assert.equal(profile.store.user, "Ada 2");
  assert.equal(profile.setUser({ name: "Grace" }), "Grace");
  assert.equal(profile.store.user, "Grace");
  profile.store.user = "direct";
  assert.equal(profile.refs.user.value, "direct");
});

test("resource snapshot and restore preserve lifecycle state", async () => {
  const first = flow({
    store: {
      greeting: asyncSignal(async () => "Hello")
    }
  });

  await first.refs.greeting.load();
  const snapshot = first.snapshot();

  assert.deepEqual(snapshot.greeting, {
    value: "Hello",
    status: "ready",
    error: undefined,
    version: 1
  });

  const second = flow({
    store: {
      greeting: asyncSignal(async () => "Ignored")
    }
  });

  second.restore(snapshot);
  assert.equal(second.refs.greeting.status, "ready");
  assert.equal(second.store.greeting, "Hello");
});

test("createResource remains a compatibility alias for createAsyncSignal", async () => {
  const api = createResource(async () => "compat");

  assert.equal(api.kind, "asyncSignal");
  assert.equal(await api.load(), "compat");
  assert.equal(api.get(), "compat");
});

test("invalid configured async signal arguments throw clear errors", async () => {
  assert.throws(
    () => createAsyncSignal({ arguments: "bad" }, async () => "ignored"),
    /options\.arguments must be an array or function/
  );

  const api = createAsyncSignal({ arguments: () => "bad" }, async () => "ignored");
  assert.throws(() => api.load(), /options\.arguments function must return an array/);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function toAbortError() {
  return new Error("aborted");
}
