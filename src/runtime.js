import {
  COMPUTED,
  RESOURCE,
  RESOURCE_IMMEDIATE,
  SIGNAL,
  STATUS,
  defineFlow,
  isComputedDefinition,
  isFlowDefinition,
  isPlainObject,
  isResourceDefinition,
  isSignalDefinition,
  isStatusDefinition
} from "./define.js";
import { isPromiseLike } from "./compose.js";
import { resolveScheduler } from "./scheduler.js";

const RESERVED_INSTANCE_NAMES = new Set([
  "get",
  "set",
  "update",
  "subscribe",
  "dispatch",
  "snapshot",
  "restore",
  "destroy",
  "store",
  "refs",
  "resources",
  "handlers"
]);

const dependencyStack = [];

export function createSignal(initial, options = {}) {
  const scheduler = resolveScheduler(options);
  const subscribers = new Set();
  let value = initial;
  let notifyScheduled = false;

  const ref = {
    [SIGNAL]: true,
    kind: "signal",

    get value() {
      return ref.get();
    },

    set value(next) {
      ref.set(next);
    },

    get() {
      trackDependency(ref);
      return value;
    },

    set(next) {
      if (Object.is(value, next)) {
        return value;
      }

      value = next;
      scheduleNotify();
      return value;
    },

    update(fn) {
      if (typeof fn !== "function") {
        throw new TypeError("Signal update requires a function.");
      }

      return ref.set(fn(value));
    },

    subscribe(fn) {
      if (typeof fn !== "function") {
        throw new TypeError("Signal subscriber must be a function.");
      }

      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    snapshot() {
      return value;
    }
  };

  function scheduleNotify() {
    if (notifyScheduled) {
      return;
    }

    notifyScheduled = true;
    const enqueue = scheduler.enqueue ?? ((fn) => fn());
    enqueue(() => {
      notifyScheduled = false;
      const current = value;

      for (const subscriber of [...subscribers]) {
        subscriber(current);
      }
    });
  }

  return ref;
}

export function createStatus(initial, allowed, options = {}) {
  const allowedValues = allowed === undefined ? undefined : [...allowed];
  const ref = createSignal(initial, options);
  const setSignalValue = ref.set;

  Object.defineProperty(ref, STATUS, {
    configurable: false,
    enumerable: false,
    value: true
  });

  ref.kind = "status";
  ref.allowed = allowedValues;
  ref.set = (next) => {
    if (allowedValues !== undefined) {
      assertAllowedStatusValue(options.name, next, allowedValues);
    }

    return setSignalValue(next);
  };
  ref.update = (fn) => {
    if (typeof fn !== "function") {
      throw new TypeError("Signal update requires a function.");
    }

    return ref.set(fn(ref.get()));
  };

  return ref;
}

export function createComputed(compute, options = {}) {
  if (typeof compute !== "function") {
    throw new TypeError("Computed store value requires a function.");
  }

  const scheduler = resolveScheduler(options);
  const subscribers = new Set();
  let value;
  let initialized = false;
  let dependencyStops = [];
  let notifyScheduled = false;

  const ref = {
    [COMPUTED]: true,
    kind: "computed",

    get value() {
      return ref.get();
    },

    get() {
      trackDependency(ref);
      return value;
    },

    subscribe(fn) {
      if (typeof fn !== "function") {
        throw new TypeError("Computed subscriber must be a function.");
      }

      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    snapshot() {
      return value;
    }
  };

  function recompute() {
    const nextDependencies = new Set();
    dependencyStack.push(nextDependencies);

    let next;
    try {
      next = compute();
    } finally {
      dependencyStack.pop();
    }

    const wasInitialized = initialized;
    const changed = !initialized || !Object.is(value, next);
    value = next;
    initialized = true;

    for (const stop of dependencyStops) {
      stop();
    }

    dependencyStops = [...nextDependencies]
      .filter((dependency) => dependency !== ref)
      .map((dependency) => dependency.subscribe(recompute));

    if (wasInitialized && changed) {
      scheduleNotify();
    }

    return value;
  }

  function scheduleNotify() {
    if (notifyScheduled) {
      return;
    }

    notifyScheduled = true;
    const enqueue = scheduler.enqueue ?? ((fn) => fn());
    enqueue(() => {
      notifyScheduled = false;
      const current = value;

      for (const subscriber of [...subscribers]) {
        subscriber(current);
      }
    });
  }

  recompute();
  return ref;
}

export function createResource(optionsOrLoader, maybeLoader, maybeRuntimeOptions) {
  const { options, loader, runtimeOptions } = normalizeCreateResourceArgs(
    optionsOrLoader,
    maybeLoader,
    maybeRuntimeOptions
  );
  const scheduler = resolveScheduler(runtimeOptions);
  const subscribers = new Set();
  const store = runtimeOptions.store ?? {};
  let status = "idle";
  let value;
  let hasValue = false;
  let error;
  let version = 0;
  let currentRun;

  const resource = {
    [RESOURCE]: true,
    kind: "resource",

    get value() {
      return value;
    },

    get status() {
      return status;
    },

    get loading() {
      return status === "loading";
    },

    get ready() {
      return status === "ready";
    },

    get error() {
      return error;
    },

    get version() {
      return version;
    },

    load(input) {
      if (currentRun) {
        return currentRun.promise;
      }

      if (status === "ready") {
        return value;
      }

      return startRun(input);
    },

    reload(input) {
      if (currentRun) {
        cancelCurrentRun();
      }

      return startRun(input);
    },

    set(next) {
      if (currentRun) {
        cancelCurrentRun();
      }

      value = next;
      hasValue = true;
      error = undefined;
      version += 1;
      setStatus("ready");
      return value;
    },

    cancel(reason) {
      if (!currentRun) {
        return status;
      }

      cancelCurrentRun(reason);
      settleCanceledRun();
      return status;
    },

    subscribe(fn) {
      if (typeof fn !== "function") {
        throw new TypeError("Resource subscriber must be a function.");
      }

      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    snapshot() {
      return {
        value,
        status,
        error,
        version
      };
    },

    restore(snapshot) {
      if (isPlainObject(snapshot) && Object.hasOwn(snapshot, "value")) {
        value = snapshot.value;
        hasValue = snapshot.status === "ready" || snapshot.value !== undefined;
        error = snapshot.error;
        version = Number.isInteger(snapshot.version) && snapshot.version >= 0
          ? snapshot.version
          : version + 1;
        setStatus(normalizeRestoredStatus(snapshot.status, hasValue));
        return;
      }

      resource.set(snapshot);
    }
  };

  if (options.immediate === true) {
    Object.defineProperty(resource, RESOURCE_IMMEDIATE, {
      configurable: false,
      enumerable: false,
      value: true
    });
  }

  if (options.immediate === true) {
    resource.load();
  }

  return resource;

  function startRun(input) {
    const controller = new AbortController();
    const runVersion = version + 1;
    const run = {
      controller,
      version: runVersion,
      promise: undefined
    };

    currentRun = run;
    version = runVersion;
    error = undefined;
    setStatus("loading");

    run.promise = Promise.resolve()
      .then(() =>
        loader(store, {
          signal: controller.signal,
          input,
          version: runVersion
        })
      )
      .then((next) => {
        if (currentRun !== run) {
          return next;
        }

        currentRun = undefined;
        value = next;
        hasValue = true;
        error = undefined;
        setStatus("ready");
        return value;
      })
      .catch((reason) => {
        if (currentRun !== run) {
          throw reason;
        }

        currentRun = undefined;
        error = reason;
        setStatus("error");
        throw reason;
      });

    return run.promise;
  }

  function cancelCurrentRun(reason) {
    const run = currentRun;
    currentRun = undefined;

    if (run && !run.controller.signal.aborted) {
      run.controller.abort(reason);
    }
  }

  function settleCanceledRun() {
    error = undefined;
    setStatus(hasValue ? "ready" : "idle");
  }

  function setStatus(next) {
    if (status === next) {
      notify();
      return;
    }

    status = next;
    notify();
  }

  function notify() {
    const enqueue = scheduler.enqueue ?? ((fn) => fn());
    enqueue(() => {
      for (const subscriber of [...subscribers]) {
        subscriber(resource);
      }
    });
  }
}

export function createStore(declarations = {}, options = {}) {
  if (!isPlainObject(declarations)) {
    throw new TypeError("createStore(...) requires a store declaration object.");
  }

  const scheduler = resolveScheduler(options);
  const refs = {};
  const resources = {};
  const plainValues = {};
  const writableNames = new Set();
  const statusNames = new Set();
  const computedEntries = [];
  const context = options.context ?? {};
  let store;

  for (const [name, declaration] of Object.entries(declarations)) {
    if (isComputedDeclaration(declaration)) {
      computedEntries.push([name, declaration]);
      continue;
    }

    if (isResourceLike(declaration)) {
      resources[name] = declaration;
      continue;
    }

    if (isPlainObject(declaration) && !isBrandedStoreEntry(declaration)) {
      if (options.rejectPlainObjects) {
        throw new TypeError(
          `Flow store "${name}" is a plain object. Nested store objects are not supported in this revision.\nWrap object values with signal(value).`
        );
      }

      plainValues[name] = declaration;
      continue;
    }

    refs[name] = createWritableRefForDeclaration(name, declaration, scheduler);
    if (refs[name]?.[STATUS]) {
      statusNames.add(name);
    }
    writableNames.add(name);
  }

  store = createStoreProxy(refs, resources, plainValues, writableNames);

  for (const [name, declaration] of Object.entries(resources)) {
    if (isResourceDefinition(declaration)) {
      resources[name] = createResource(declaration, {
        scheduler,
        store,
        name
      });
    }
  }

  for (const [name, declaration] of computedEntries) {
    const compute = typeof declaration === "function" ? declaration : declaration.compute;
    refs[name] = createComputed(() => compute(store, context), { scheduler });
  }

  return {
    store,
    refs,
    resources,
    writableNames,
    statusNames,
    snapshot() {
      const snapshot = {};

      for (const [name, ref] of Object.entries(refs)) {
        snapshot[name] = ref.snapshot();
      }

      for (const [name, resource] of Object.entries(resources)) {
        snapshot[name] = resource.snapshot();
      }

      for (const [name, value] of Object.entries(plainValues)) {
        snapshot[name] = value;
      }

      return snapshot;
    },
    restore(snapshot) {
      if (!isPlainObject(snapshot)) {
        throw new TypeError("Store restore(...) requires a snapshot object.");
      }

      for (const [name, value] of Object.entries(snapshot)) {
        const ref = refs[name];

        if (ref?.[SIGNAL] || ref?.[STATUS]) {
          ref.set(value);
        } else if (resources[name]) {
          resources[name].restore(value);
        } else if (Object.hasOwn(plainValues, name)) {
          plainValues[name] = value;
        }
      }
    }
  };
}

export function createFlow(definitionOrConfig, options = {}) {
  const definition = isFlowDefinition(definitionOrConfig)
    ? definitionOrConfig
    : defineFlow(definitionOrConfig);
  const runtimeOptions = validateRuntimeOptions(options);
  const scheduler = resolveScheduler(runtimeOptions);
  const handlers = {};
  const rawHandlers = {};
  const transitionMetadata = new Map();
  const wholeSubscribers = new Set();
  const refStops = [];
  const cleanups = new Set();
  let activeBatch = null;
  let destroyed = false;
  let timeoutId = 0;
  let flow;

  for (const [name, handler] of Object.entries(definition.on)) {
    if (handler?._flowTransition) {
      transitionMetadata.set(name, handler._flowTransition);
    }
  }

  const declaredStatusNames = Object.entries(definition.store)
    .filter(([, declaration]) => isStatusDefinition(declaration))
    .map(([name]) => name);

  const storeState = createStore(definition.store, {
    scheduler,
    rejectPlainObjects: true,
    context: {
      describe: () => ({
        statuses: declaredStatusNames,
        transitions: Object.fromEntries(transitionMetadata),
        handlers: Object.keys(definition.on)
      })
    }
  });
  const { store, refs, resources, writableNames, statusNames } = storeState;

  flow = {
    store,
    refs,
    resources,
    handlers,

    get(name) {
      assertKnownStoreValue(refs, resources, name);
      return store[name];
    },

    set(name, value) {
      assertWritable(refs, writableNames, name);
      return runFlowBatch(undefined, undefined, () => {
        store[name] = value;
        return store[name];
      });
    },

    update(name, fn) {
      assertWritable(refs, writableNames, name);
      if (typeof fn !== "function") {
        throw new TypeError("Flow update(...) requires an updater function.");
      }

      return runFlowBatch(undefined, undefined, () => {
        store[name] = fn(store[name]);
        return store[name];
      });
    },

    subscribe(nameOrFn, maybeFn) {
      if (typeof nameOrFn === "function") {
        wholeSubscribers.add(nameOrFn);
        return () => wholeSubscribers.delete(nameOrFn);
      }

      assertKnownStoreValue(refs, resources, nameOrFn);
      if (!refs[nameOrFn]) {
        throw new Error(`Flow store value "${nameOrFn}" is not subscribable.`);
      }
      return refs[nameOrFn].subscribe(maybeFn);
    },

    dispatch(name, input) {
      if (destroyed) {
        throw new Error("Flow instance has been destroyed.");
      }

      const handler = rawHandlers[name];
      if (typeof handler !== "function") {
        throw new Error(`Unknown Flow handler "${name}".`);
      }

      const receiver = createHandlerReceiver(input);
      const result = runFlowBatch(name, input, () => {
        const next = handler.call(receiver, store, input);

        if (isPromiseLike(next)) {
          return next;
        }

        return applyHandlerResult(next);
      });

      if (isPromiseLike(result)) {
        return Promise.resolve(result).then((next) =>
          runFlowBatch(name, input, () => applyHandlerResult(next))
        );
      }

      return result;
    },

    snapshot() {
      return storeState.snapshot();
    },

    restore(snapshot) {
      runFlowBatch(undefined, undefined, () => storeState.restore(snapshot));
    },

    destroy() {
      destroyed = true;

      for (const cleanup of [...cleanups]) {
        cleanup();
      }
      cleanups.clear();

      for (const stop of refStops.splice(0)) {
        stop();
      }

      wholeSubscribers.clear();
    },

    _describe() {
      return {
        writable: [...writableNames],
        statuses: [...statusNames],
        transitions: Object.fromEntries(transitionMetadata),
        store: Object.keys(refs),
        resources: Object.keys(resources),
        handlers: Object.keys(handlers)
      };
    }
  };

  for (const [name, ref] of Object.entries(refs)) {
    refStops.push(ref.subscribe((value) => recordChange(name, value)));
  }

  for (const [name, resource] of Object.entries(resources)) {
    refStops.push(resource.subscribe(() => recordChange(name, store[name])));
  }

  for (const [name, handler] of Object.entries(definition.on)) {
    registerHandler(name, handler);
  }

  function registerHandler(name, handler) {
    rawHandlers[name] = handler;
    handlers[name] = (input) => flow.dispatch(name, input);
    handlers[name].raw = handler;

    if (!RESERVED_INSTANCE_NAMES.has(name) && !Object.hasOwn(flow, name)) {
      Object.defineProperty(flow, name, {
        configurable: true,
        enumerable: true,
        value(input) {
          return flow.dispatch(name, input);
        }
      });
    }
  }

  function createHandlerReceiver(input) {
    const receiver = {
      store,
      refs,
      resources,
      dispatch: flow.dispatch.bind(flow),
      _describe: flow._describe.bind(flow),
      after(ms, eventName, nextInput) {
        if (!Number.isFinite(ms) || ms < 0) {
          throw new TypeError("after(...) requires a non-negative millisecond delay.");
        }
        if (typeof eventName !== "string" || eventName.length === 0) {
          throw new TypeError("after(...) requires an event name.");
        }

        const id = ++timeoutId;
        const timeout = setTimeout(() => {
          cleanups.delete(cleanup);
          flow.dispatch(eventName, nextInput);
        }, ms);
        const cleanup = () => clearTimeout(timeout);
        cleanups.add(cleanup);
        return id;
      },
      dispose(cleanup) {
        if (typeof cleanup !== "function") {
          throw new TypeError("dispose(...) requires a cleanup function.");
        }

        cleanups.add(cleanup);
        return () => cleanups.delete(cleanup);
      }
    };

    const extra = resolveRuntimeContext(runtimeOptions.context, {
      flow,
      store,
      input
    });

    return {
      ...receiver,
      ...extra
    };
  }

  function runFlowBatch(name, input, fn) {
    const previousBatch = activeBatch;
    const batch = {
      name,
      input,
      store: {}
    };
    activeBatch = batch;

    let result;
    try {
      result = scheduler.batch(fn);
    } finally {
      activeBatch = previousBatch;
    }

    if (Object.keys(batch.store).length > 0) {
      notifyWholeSubscribers({
        name,
        input,
        store: batch.store
      });
    }

    return result;
  }

  function recordChange(name, value) {
    if (activeBatch) {
      activeBatch.store[name] = value;
      return;
    }

    notifyWholeSubscribers({
      store: {
        [name]: value
      }
    });
  }

  function notifyWholeSubscribers(change) {
    for (const subscriber of [...wholeSubscribers]) {
      subscriber(change);
    }
  }

  function applyHandlerResult(result) {
    if (!isPlainObject(result)) {
      return result;
    }

    return applyStoreUpdates(result);
  }

  function applyStoreUpdates(updates) {
    for (const [name, value] of Object.entries(updates)) {
      assertWritable(refs, writableNames, name);
      store[name] = value;
    }

    return updates;
  }

  return flow;
}

function createWritableRefForDeclaration(name, declaration, scheduler) {
  if (isStatusDefinition(declaration)) {
    return createStatus(declaration.initial, declaration.allowed, {
      name,
      scheduler
    });
  }

  if (isSignalDefinition(declaration)) {
    return createSignal(declaration.initial, { scheduler });
  }

  return createSignal(declaration, { scheduler });
}

function createStoreProxy(refs, resources, plainValues, writableNames) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") {
          return undefined;
        }

        const entry = refs[prop] ?? resources[prop];

        if (entry?.[SIGNAL] || entry?.[STATUS] || entry?.[COMPUTED]) {
          return entry.get();
        }

        if (entry?.[RESOURCE]) {
          return entry?.[RESOURCE_IMMEDIATE] ? entry.value : entry;
        }

        return plainValues[prop];
      },

      set(_target, prop, value) {
        if (typeof prop === "symbol") {
          return false;
        }

        const entry = refs[prop] ?? resources[prop];

        if (entry?.[STATUS]) {
          entry.set(value);
          return true;
        }

        if (entry?.[SIGNAL]) {
          entry.set(value);
          return true;
        }

        if (entry?.[COMPUTED]) {
          throw new Error("Computed store values are read-only.");
        }

        if (entry?.[RESOURCE]) {
          throw new Error("Resource store values are controlled through resource methods.");
        }

        if (!Object.hasOwn(plainValues, prop)) {
          throw new Error(`Unknown Flow store value "${prop}".`);
        }

        plainValues[prop] = value;
        writableNames.add(prop);
        return true;
      },

      has(_target, prop) {
        return Object.hasOwn(refs, prop) || Object.hasOwn(resources, prop) || Object.hasOwn(plainValues, prop);
      },

      ownKeys() {
        return [...new Set([
          ...Object.keys(refs),
          ...Object.keys(resources),
          ...Object.keys(plainValues)
        ])];
      },

      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === "symbol") {
          return undefined;
        }

        if (prop in refs || prop in resources || prop in plainValues) {
          return {
            configurable: true,
            enumerable: true
          };
        }

        return undefined;
      }
    }
  );
}

function isComputedDeclaration(value) {
  return typeof value === "function" || isComputedDefinition(value);
}

function isBrandedStoreEntry(value) {
  return isSignalDefinition(value) || isStatusDefinition(value) || isComputedDefinition(value) || isResourceLike(value);
}

function isResourceLike(value) {
  return Boolean(value && typeof value === "object" && value[RESOURCE]);
}

function normalizeCreateResourceArgs(optionsOrLoader, maybeLoader, maybeRuntimeOptions) {
  if (isResourceDefinition(optionsOrLoader)) {
    return {
      options: optionsOrLoader.options,
      loader: optionsOrLoader.loader,
      runtimeOptions: isPlainObject(maybeLoader) ? maybeLoader : {}
    };
  }

  if (typeof optionsOrLoader === "function") {
    return {
      options: { immediate: false },
      loader: optionsOrLoader,
      runtimeOptions: isPlainObject(maybeLoader) ? maybeLoader : {}
    };
  }

  if (!isPlainObject(optionsOrLoader)) {
    throw new TypeError("createResource(...) options must be an object when provided.");
  }

  if (typeof maybeLoader !== "function") {
    throw new TypeError("createResource(...) requires a loader function.");
  }

  return {
    options: {
      ...optionsOrLoader,
      immediate: optionsOrLoader.immediate === true
    },
    loader: maybeLoader,
    runtimeOptions: isPlainObject(maybeRuntimeOptions) ? maybeRuntimeOptions : {}
  };
}

function normalizeRestoredStatus(status, hasValue) {
  if (status === "loading") {
    return hasValue ? "ready" : "idle";
  }

  if (status === "ready" && hasValue) {
    return "ready";
  }

  if (status === "error") {
    return "error";
  }

  return hasValue ? "ready" : "idle";
}

function assertAllowedStatusValue(name, value, allowedValues) {
  if (!allowedValues.some((allowed) => Object.is(allowed, value))) {
    throw new Error(`Invalid status value for Flow store "${name}".`);
  }
}

function assertKnownStoreValue(refs, resources, name) {
  if (!Object.hasOwn(refs, name) && !Object.hasOwn(resources, name)) {
    throw new Error(`Unknown Flow store value "${name}".`);
  }
}

function assertWritable(refs, writableNames, name) {
  if (!Object.hasOwn(refs, name)) {
    throw new Error(`Unknown Flow store value "${name}".`);
  }

  if (!writableNames.has(name)) {
    throw new Error(`Flow store value "${name}" is read-only.`);
  }
}

function trackDependency(ref) {
  const current = dependencyStack[dependencyStack.length - 1];
  if (current) {
    current.add(ref);
  }
}

function validateRuntimeOptions(options) {
  if (options === undefined) {
    return {};
  }

  if (!isPlainObject(options)) {
    throw new TypeError("Flow runtime options must be an object.");
  }

  for (const key of Object.keys(options)) {
    if (key !== "scheduler" && key !== "context") {
      throw new TypeError(`Unknown Flow runtime option "${key}".`);
    }
  }

  if (options.context !== undefined && typeof options.context !== "function" && !isPlainObject(options.context)) {
    throw new TypeError("Flow context option must be an object or function.");
  }

  return options;
}

function resolveRuntimeContext(context, payload) {
  if (context === undefined) {
    return {};
  }

  const resolved = typeof context === "function" ? context(payload) : context;

  if (resolved === undefined) {
    return {};
  }

  if (!isPlainObject(resolved)) {
    throw new TypeError("Flow context option must resolve to an object.");
  }

  return resolved;
}
