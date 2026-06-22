import assert from "node:assert/strict";
import test from "node:test";
import {
  RESOURCE,
  RESOURCE_IMMEDIATE,
  createResource,
  defineResource,
  flow,
  isImmediateResource,
  isResource,
  resource
} from "@async/flow";

test("resource and defineResource create import-safe lazy declarations", () => {
  const loader = async () => "hello";
  const greeting = resource(loader);
  const profile = defineResource({ immediate: true }, loader);

  assert.equal(greeting[RESOURCE], true);
  assert.equal(greeting[RESOURCE_IMMEDIATE], undefined);
  assert.equal(greeting.loader, loader);
  assert.equal(greeting.options.immediate, false);
  assert.equal(profile[RESOURCE], true);
  assert.equal(profile[RESOURCE_IMMEDIATE], true);
  assert.equal(isResource(greeting), true);
  assert.equal(isImmediateResource(greeting), false);
  assert.equal(isImmediateResource(profile), true);
});

test("createResource is lazy by default and loads from idle loading ready and error", async () => {
  let calls = 0;
  const first = deferred();
  const api = createResource(async (_store, tools) => {
    calls += 1;
    if (tools.input === "fail") {
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

  first.resolve("hello");
  assert.equal(await pending, "hello");
  assert.equal(api.status, "ready");
  assert.equal(api.ready, true);
  assert.equal(api.value, "hello");
  assert.equal(api.load(), "hello");

  const failing = createResource(async (_store, tools) => {
    calls += 1;
    if (tools.input === "fail") {
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
  const api = createResource(async (_store, tools) => {
    const run = deferred();
    runs.push({ ...tools, ...run });
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
});

test("set updates resource value without running the loader", () => {
  let calls = 0;
  const api = createResource(async () => {
    calls += 1;
    return "loaded";
  });

  assert.equal(api.set("manual"), "manual");
  assert.equal(api.value, "manual");
  assert.equal(api.status, "ready");
  assert.equal(calls, 0);
});

test("cancel settles to idle without value and ready with value", async () => {
  const emptyRun = deferred();
  const empty = createResource(async (_store, tools) => {
    if (tools.signal.aborted) {
      throw toAbortError();
    }
    tools.signal.addEventListener("abort", () => emptyRun.reject(toAbortError()));
    return emptyRun.promise;
  });

  const emptyPromise = empty.load();
  assert.equal(empty.cancel("stop"), "idle");
  assert.equal(empty.status, "idle");
  await assert.rejects(() => emptyPromise, /aborted/);

  const loadedRun = deferred();
  const loaded = createResource(async (_store, tools) => {
    if (tools.signal.aborted) {
      throw toAbortError();
    }
    tools.signal.addEventListener("abort", () => loadedRun.reject(toAbortError()));
    return loadedRun.promise;
  });

  loaded.set("cached");
  const loadedPromise = loaded.reload();
  assert.equal(loaded.cancel(), "ready");
  assert.equal(loaded.value, "cached");
  assert.equal(loaded.status, "ready");
  await assert.rejects(() => loadedPromise, /aborted/);
});

test("loaders receive native abort signal input and version", async () => {
  const seen = [];
  const api = createResource(async (store, tools) => {
    seen.push({
      userId: store.userId,
      signal: tools.signal,
      input: tools.input,
      version: tools.version
    });
    return `${store.userId}:${tools.input}`;
  }, {
    store: {
      userId: "user_123"
    }
  });

  assert.equal(await api.load("profile"), "user_123:profile");
  assert.equal(seen[0].signal instanceof AbortSignal, true);
  assert.deepEqual(seen.map(({ userId, input, version }) => ({ userId, input, version })), [
    { userId: "user_123", input: "profile", version: 1 }
  ]);
});

test("lazy resources stay resource objects in store and expose controllers through flow resources", async () => {
  const greetingFlow = flow({
    store: {
      name: "World",
      greeting: resource(async (store, { signal }) => {
        assert.equal(signal instanceof AbortSignal, true);
        return `Hello ${store.name}`;
      })
    },
    on: {
      fetch(store) {
        return store.greeting.load();
      },
      retry(store) {
        return store.greeting.reload();
      },
      replace(store, input) {
        return store.greeting.set(input.value);
      },
      cancel(store) {
        return store.greeting.cancel();
      }
    }
  });

  assert.equal(greetingFlow.store.greeting.status, "idle");
  assert.equal(greetingFlow.resources.greeting, greetingFlow.store.greeting);
  assert.equal(await greetingFlow.fetch(), "Hello World");
  assert.equal(greetingFlow.store.greeting.value, "Hello World");
  assert.equal(await greetingFlow.retry(), "Hello World");
  assert.equal(greetingFlow.replace({ value: "Hi World" }), "Hi World");
  assert.equal(greetingFlow.cancel(), "ready");
  assert.throws(() => {
    greetingFlow.store.greeting = "direct";
  }, /Resource store values/);
});

test("immediate resources are value-like in store and controller-like through receiver resources", async () => {
  let calls = 0;
  const profile = flow({
    store: {
      user: resource({ immediate: true }, async () => {
        calls += 1;
        return `Ada ${calls}`;
      })
    },
    on: {
      refreshUser() {
        return this.resources.user.reload();
      },
      setUser(_store, input) {
        return this.resources.user.set(input.name);
      }
    }
  });

  assert.equal(profile.resources.user.status, "loading");
  assert.equal(profile.store.user, undefined);
  assert.equal(await profile.resources.user.load(), "Ada 1");
  assert.equal(profile.store.user, "Ada 1");
  assert.equal(await profile.refreshUser(), "Ada 2");
  assert.equal(profile.store.user, "Ada 2");
  assert.equal(profile.setUser({ name: "Grace" }), "Grace");
  assert.equal(profile.store.user, "Grace");
  assert.throws(() => {
    profile.store.user = "direct";
  }, /Resource store values/);
});

test("resource snapshot and restore preserve lifecycle state", async () => {
  const first = flow({
    store: {
      greeting: resource(async () => "Hello")
    }
  });

  await first.store.greeting.load();
  const snapshot = first.snapshot();

  assert.deepEqual(snapshot.greeting, {
    value: "Hello",
    status: "ready",
    error: undefined,
    version: 1
  });

  const second = flow({
    store: {
      greeting: resource(async () => "Ignored")
    }
  });

  second.restore(snapshot);
  assert.equal(second.store.greeting.status, "ready");
  assert.equal(second.store.greeting.value, "Hello");
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
