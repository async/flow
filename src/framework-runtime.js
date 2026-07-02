import {
  COMPUTED,
  ASYNC_SIGNAL,
  ASYNC_SIGNAL_IMMEDIATE,
  SIGNAL,
  STATUS,
  defineStatus,
  defineFlow,
  isComputedDefinition,
  isFlowDefinition,
  isPlainObject,
  isAsyncSignalDefinition,
  isSignalDefinition,
  isStatusDefinition
} from "./define.js";
import { COMPOSE_BATCH, isPromiseLike } from "./compose.js";
import { FLOW_INSPECT, FLOW_INSTANCE, GUARD, TRANSITION } from "./protocol.js";

export { FLOW_INSPECT, FLOW_INSTANCE };

const RESERVED_INSTANCE_NAMES = new Set([
  "_",
  "get",
  "set",
  "update",
  "subscribe",
  "dispatch",
  "explain",
  "snapshot",
  "restore",
  "destroy",
  "store",
  "refs",
  "asyncSignals",
  "handlers"
]);

const dependencyStack = [];
const immediateScheduler = {
  batch(fn) {
    return fn();
  },
  enqueue(fn) {
    fn();
  },
  async flush() {}
};

export function createSignal(initial, options = {}) {
  const scheduler = resolveRuntimeScheduler(options);
  const subscribers = new Set();
  let value = initial;
  let notifyScheduled = false;

  const ref = {
    [SIGNAL]: true,
    type: "signal",

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
    },

    restore(snapshot) {
      ref.set(snapshot);
    }
  };

  function scheduleNotify() {
    if (notifyScheduled) {
      return;
    }

    notifyScheduled = true;
    const enqueue = scheduler.enqueue ?? ((fn) => fn());
    enqueue(() => {
      try {
        notifyScheduled = false;
        const current = value;

        for (const subscriber of [...subscribers]) {
          subscriber(current);
        }
      } finally {
        notifyScheduled = false;
      }
    });
  }

  return ref;
}

export function createStatus(initial, allowed, options = {}) {
  const definition = defineStatus(initial, allowed);
  const allowedValues = definition.allowed;
  const ref = createSignal(definition.initial, options);
  const setSignalValue = ref.set;

  Object.defineProperty(ref, STATUS, {
    configurable: false,
    enumerable: false,
    value: true
  });

  ref.type = "status";
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

export function createComputed(optionsOrCompute, maybeCompute, maybeRuntimeOptions) {
  const { options, compute, runtimeOptions } = normalizeCreateComputedArgs(
    optionsOrCompute,
    maybeCompute,
    maybeRuntimeOptions
  );

  if (typeof compute !== "function") {
    throw new TypeError("Computed store value requires a function.");
  }

  const scheduler = resolveRuntimeScheduler(runtimeOptions);
  const subscribers = new Set();
  let value;
  let initialized = false;
  let dependencyStops = [];
  let notifyScheduled = false;

  const ref = {
    [COMPUTED]: true,
    type: "computed",

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
      const args = resolveConfiguredArguments("computed", options.arguments, runtimeOptions.store);
      next = compute.apply(createComputedReceiver(runtimeOptions), args);
    } finally {
      dependencyStack.pop();
    }

    if (isPromiseLike(next)) {
      throw new TypeError("Computed callbacks must return synchronously.");
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
      try {
        notifyScheduled = false;
        const current = value;

        for (const subscriber of [...subscribers]) {
          subscriber(current);
        }
      } finally {
        notifyScheduled = false;
      }
    });
  }

  recompute();
  return ref;
}

export function createAsyncSignal(optionsOrLoader, maybeLoader, maybeRuntimeOptions) {
  const { options, loader, runtimeOptions } = normalizeCreateAsyncSignalArgs(
    optionsOrLoader,
    maybeLoader,
    maybeRuntimeOptions
  );
  const scheduler = resolveRuntimeScheduler(runtimeOptions);
  const subscribers = new Set();
  let store;
  let refs;
  let asyncSignals;
  let status = "idle";
  let value;
  let hasValue = false;
  let error;
  let version = 0;
  let currentRun;

  const asyncSignalRef = {
    [ASYNC_SIGNAL]: true,
    type: "asyncSignal",

    get value() {
      return asyncSignalRef.get();
    },

    get status() {
      trackDependency(asyncSignalRef);
      return status;
    },

    get loading() {
      trackDependency(asyncSignalRef);
      return status === "loading";
    },

    get ready() {
      trackDependency(asyncSignalRef);
      return status === "ready";
    },

    get error() {
      trackDependency(asyncSignalRef);
      return error;
    },

    get version() {
      trackDependency(asyncSignalRef);
      return version;
    },

    get() {
      trackDependency(asyncSignalRef);
      return value;
    },

    load(...args) {
      if (currentRun) {
        return currentRun.promise;
      }

      if (status === "ready") {
        return value;
      }

      return startRun(args);
    },

    reload(...args) {
      if (currentRun) {
        cancelCurrentRun();
      }

      return startRun(args);
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

    update(fn) {
      if (typeof fn !== "function") {
        throw new TypeError("Async signal update requires a function.");
      }

      return asyncSignalRef.set(fn(value));
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
        throw new TypeError("Async signal subscriber must be a function.");
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
        if (currentRun) {
          cancelCurrentRun();
        }

        value = snapshot.value;
        hasValue = snapshot.status === "ready" || snapshot.value !== undefined;
        error = snapshot.error;
        version = Number.isInteger(snapshot.version) && snapshot.version >= 0
          ? snapshot.version
          : version + 1;
        setStatus(normalizeRestoredStatus(snapshot.status, hasValue));
        return;
      }

      asyncSignalRef.set(snapshot);
    },

    _attachStore(nextStore, nextRefs, nextAsyncSignals) {
      store = nextStore;
      refs = nextRefs;
      asyncSignals = nextAsyncSignals;
      if (runtimeOptions.deferImmediate === true && options.immediate === true) {
        sinkAsyncSignalRun(asyncSignalRef.load());
      }
    }
  };

  if (options.immediate === true) {
    Object.defineProperty(asyncSignalRef, ASYNC_SIGNAL_IMMEDIATE, {
      configurable: false,
      enumerable: false,
      value: true
    });
  }

  if (options.immediate === true && runtimeOptions.deferImmediate !== true) {
    sinkAsyncSignalRun(asyncSignalRef.load());
  }

  return asyncSignalRef;

  function startRun(explicitArgs) {
    const controller = new AbortController();
    const runVersion = version + 1;
    const args = resolveConfiguredArguments("asyncSignal", options.arguments, store, explicitArgs);
    const run = {
      controller,
      version: runVersion,
      args,
      promise: undefined
    };

    currentRun = run;
    version = runVersion;
    error = undefined;
    setStatus("loading");

    run.promise = Promise.resolve()
      .then(() =>
        loader.apply(createAsyncSignalReceiver({
          store,
          refs,
          asyncSignals,
          name: runtimeOptions.name,
          signal: controller.signal,
          version: runVersion,
          args
        }), args)
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

    run?.promise?.catch(() => {});

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
        subscriber(value);
      }
    });
  }
}

function sinkAsyncSignalRun(result) {
  if (isPromiseLike(result)) {
    Promise.resolve(result).catch(() => {});
  }
}

export function createStore(declarations = {}, options = {}) {
  if (!isPlainObject(declarations)) {
    throw new TypeError("createStore(...) requires a store declaration object.");
  }

  const scheduler = resolveRuntimeScheduler(options);
  const refs = {};
  const asyncSignals = {};
  const plainValues = {};
  const writableNames = new Set();
  const statusNames = new Set();
  const computedEntries = [];
  const context = options.context ?? {};
  let store;

  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(declarations))) {
    if (isAccessorDescriptor(descriptor)) {
      if (typeof descriptor.get !== "function" || descriptor.set !== undefined) {
        throw new TypeError(`Flow store "${name}" accessor declarations must be getter-only.`);
      }

      computedEntries.push([name, function storeGetterComputed() {
        return descriptor.get.call(this);
      }]);
      continue;
    }

    const declaration = descriptor.value;

    if (isComputedDeclaration(declaration)) {
      computedEntries.push([name, declaration]);
      continue;
    }

    if (isAsyncSignalLike(declaration)) {
      const ref = isAsyncSignalDefinition(declaration)
        ? createAsyncSignal(declaration, {
            scheduler,
            name,
            deferImmediate: true
          })
        : declaration;
      refs[name] = ref;
      asyncSignals[name] = ref;
      writableNames.add(name);
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

  store = createStoreProxy(refs, asyncSignals, plainValues, writableNames);

  for (const ref of Object.values(refs)) {
    if (ref?.[ASYNC_SIGNAL] && typeof ref._attachStore === "function") {
      ref._attachStore(store, refs, asyncSignals);
    }
  }

  for (const [name, declaration] of computedEntries) {
    const compute = typeof declaration === "function" ? declaration : declaration.compute;
    refs[name] = typeof declaration === "function"
      ? createComputed(compute, { scheduler, store, refs, name, context })
      : createComputed(declaration.options ?? {}, compute, { scheduler, store, refs, name, context });
  }

  const internal = createInternalStoreNamespace(refs, asyncSignals, plainValues);

  return {
    store,
    refs,
    asyncSignals,
    internal,
    writableNames,
    statusNames,
    snapshot() {
      const snapshot = {};

      for (const [name, ref] of Object.entries(refs)) {
        snapshot[name] = ref.snapshot();
      }

      for (const [name, asyncSignalRef] of Object.entries(asyncSignals)) {
        if (refs[name] === asyncSignalRef) {
          continue;
        }

        snapshot[name] = asyncSignalRef.snapshot();
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
        } else if (ref?.[ASYNC_SIGNAL]) {
          ref.restore(value);
        } else if (asyncSignals[name]) {
          asyncSignals[name].restore(value);
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
  const scheduler = resolveRuntimeScheduler(runtimeOptions);
  const handlers = {};
  const rawHandlers = {};
  const transitionMetadata = new Map();
  const guardMetadata = new Map();
  const wholeSubscribers = new Set();
  const refStops = [];
  const subscriberStops = [];
  const suppressedSnapshots = [];
  const cleanups = new Set();
  let activeBatch = null;
  let destroyed = false;
  let timeoutId = 0;
  let flow;

  for (const [name, handler] of Object.entries(definition.on)) {
    if (handler?.[TRANSITION]) {
      transitionMetadata.set(name, handler[TRANSITION]);
    }

    if (handler?.[GUARD]) {
      guardMetadata.set(name, handler[GUARD]);
    }
  }

  const storeState = createStore(definition.store, {
    scheduler,
    rejectPlainObjects: true,
    context: {
      explain: (eventName, input, storeOverride, options) =>
        explainEvent(eventName, input, storeOverride, options),
      transition: (eventName) => transitionMetadata.get(eventName)
    }
  });
  const { store, refs, asyncSignals, internal, writableNames, statusNames } = storeState;
  const publicViews = createFlowViews({
    store,
    refs,
    asyncSignals,
    internal,
    assertAlive,
    mutate: (fn) => runFlowBatch(undefined, undefined, fn),
    trackStop: trackSubscriberStop
  });

  flow = {
    store: publicViews.store,
    refs: publicViews.refs,
    asyncSignals: publicViews.asyncSignals,
    handlers,

    get(name) {
      assertKnownStoreValue(refs, asyncSignals, name);
      return store[name];
    },

    set(name, value) {
      assertAlive();
      assertWritable(refs, writableNames, name);
      return runFlowBatch(undefined, undefined, () => {
        store[name] = value;
        return store[name];
      });
    },

    update(name, fn) {
      assertAlive();
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
      assertAlive();
      if (typeof nameOrFn === "function") {
        wholeSubscribers.add(nameOrFn);
        return () => wholeSubscribers.delete(nameOrFn);
      }

      assertKnownStoreValue(refs, asyncSignals, nameOrFn);
      if (!refs[nameOrFn]) {
        throw new Error(`Flow store value "${nameOrFn}" is not subscribable.`);
      }
      return publicViews.refs[nameOrFn].subscribe(maybeFn);
    },

    dispatch(name, input) {
      assertAlive();

      const handler = rawHandlers[name];
      if (typeof handler !== "function") {
        throw new Error(`Unknown Flow handler "${name}".`);
      }

      return runDispatchBatch(name, input, handler);
    },

    explain(eventName, input) {
      return explainEvent(eventName, input);
    },

    snapshot() {
      return storeState.snapshot();
    },

    restore(snapshot) {
      assertAlive();
      runFlowBatch(undefined, undefined, () => storeState.restore(snapshot));
    },

    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;

      for (const cleanup of [...cleanups]) {
        cleanup();
      }
      cleanups.clear();

      for (const stop of subscriberStops.splice(0)) {
        stop();
      }

      for (const stop of refStops.splice(0)) {
        stop();
      }

      for (const asyncSignalRef of Object.values(asyncSignals)) {
        asyncSignalRef.cancel?.(new Error("Flow instance has been destroyed."));
      }

      wholeSubscribers.clear();
    }
  };

  Object.defineProperty(flow, "_", {
    configurable: false,
    enumerable: false,
    value: publicViews.internal,
    writable: false
  });

  Object.defineProperty(flow, FLOW_INSTANCE, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });

  Object.defineProperty(flow, FLOW_INSPECT, {
    configurable: false,
    enumerable: false,
    value: describeFlow,
    writable: false
  });

  for (const [name, ref] of Object.entries(refs)) {
    refStops.push(ref.subscribe(() => recordChange()));
  }

  for (const [name, asyncSignalRef] of Object.entries(asyncSignals)) {
    if (refs[name] === asyncSignalRef) {
      continue;
    }

    refStops.push(asyncSignalRef.subscribe(() => recordChange()));
  }

  for (const [name, handler] of Object.entries(definition.on)) {
    registerHandler(name, handler);
  }

  projectStoreValues();

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

  function projectStoreValues() {
    for (const name of Object.keys(store)) {
      if (
        isInternalStoreName(name) ||
        RESERVED_INSTANCE_NAMES.has(name) ||
        Object.hasOwn(flow, name)
      ) {
        continue;
      }

      Object.defineProperty(flow, name, {
        configurable: true,
        enumerable: true,
        get() {
          return store[name];
        },
        set(value) {
          flow.set(name, value);
        }
      });
    }
  }

  function assertAlive() {
    if (destroyed) {
      throw new Error("Flow instance has been destroyed.");
    }
  }

  function trackSubscriberStop(stop) {
    subscriberStops.push(stop);
    return () => {
      const index = subscriberStops.indexOf(stop);
      if (index !== -1) {
        subscriberStops.splice(index, 1);
      }
      stop();
    };
  }

  function createHandlerReceiver(name, input, batch, views) {
    const receiver = {
      [FLOW_INSTANCE]: true,
      [FLOW_INSPECT]: describeFlow,
      store: views.store,
      refs: views.refs,
      asyncSignals: views.asyncSignals,
      dispatch: flow.dispatch.bind(flow),
      explain: flow.explain.bind(flow),
      [COMPOSE_BATCH](fn) {
        return runInBatch(batch, fn);
      },
      after(ms, eventName, nextInput) {
        assertAlive();
        if (!Number.isFinite(ms) || ms < 0) {
          throw new TypeError("after(...) requires a non-negative millisecond delay.");
        }
        if (typeof eventName !== "string" || eventName.length === 0) {
          throw new TypeError("after(...) requires an event name.");
        }
        if (typeof rawHandlers[eventName] !== "function") {
          throw new Error(`Unknown Flow handler "${eventName}".`);
        }

        const id = ++timeoutId;
        const timeout = setTimeout(() => {
          cleanups.delete(cleanup);
          if (destroyed) {
            return;
          }

          try {
            const result = flow.dispatch(eventName, nextInput);

            if (isPromiseLike(result)) {
              Promise.resolve(result).catch(() => {});
            }
          } catch {
            // Timer-driven dispatches cannot report back to a caller.
          }
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
      store: views.store,
      input
    });

    return {
      ...receiver,
      ...extra
    };
  }

  function describeFlow() {
    return {
      store: describeStore(),
      asyncSignals: describeAsyncSignals(),
      handlers: Object.keys(handlers),
      transitions: describeTransitions(),
      guards: describeGuards()
    };
  }

  function describeStore() {
    const description = {};

    for (const [name, ref] of Object.entries(refs)) {
      const entry = {
        type: ref.type,
        writable: writableNames.has(name),
        value: cloneInspectable(store[name])
      };

      if (ref?.[STATUS] && Array.isArray(ref.allowed)) {
        entry.allowed = cloneInspectable(ref.allowed);
      }

      description[name] = entry;
    }

    return description;
  }

  function describeAsyncSignals() {
    const description = {};

    for (const [name, asyncSignalRef] of Object.entries(asyncSignals)) {
      description[name] = {
        type: "asyncSignal",
        status: asyncSignalRef.status,
        loading: asyncSignalRef.loading,
        ready: asyncSignalRef.ready,
        version: asyncSignalRef.version
      };
    }

    return description;
  }

  function describeTransitions() {
    const description = {};

    for (const [eventName, metadata] of transitionMetadata.entries()) {
      description[eventName] = {
        status: metadata.status,
        rules: metadata.rules.map(describeTransitionRule)
      };
    }

    return description;
  }

  function describeGuards() {
    const description = {};

    for (const [eventName, metadata] of guardMetadata.entries()) {
      description[eventName] = {
        conditional: true,
        ...copyPublicMetadata(metadata)
      };
    }

    return description;
  }

  function explainEvent(eventName, input, storeOverride = store, options = {}) {
    if (typeof eventName !== "string" || eventName.length === 0 || !Object.hasOwn(definition.on, eventName)) {
      return {
        event: eventName,
        allowed: false,
        reason: "unknown_event"
      };
    }

    const requiredStatus = options?.statusName;
    const transition = transitionMetadata.get(eventName);
    const guard = guardMetadata.get(eventName);

    if (requiredStatus !== undefined && transition?.status !== requiredStatus) {
      return {
        event: eventName,
        allowed: false,
        reason: "no_matching_transition",
        source: "transition",
        status: requiredStatus
      };
    }

    if (!transition && !guard) {
      return {
        event: eventName,
        allowed: true,
        reason: "plain_handler",
        source: "handler"
      };
    }

    const readonlyStore = createReadonlyStoreView(storeOverride);

    const guardResult = guard
      ? explainGuard(guard, createReadonlyFlowReceiver(readonlyStore), readonlyStore, input)
      : { allowed: true };

    if (guard && !guardResult.allowed) {
      const metadata = guardResult.dynamicMetadata === true
        ? copyPublicMetadata(guardResult)
        : {
            ...copyPublicMetadata(guard),
            ...copyPublicMetadata(guardResult)
          };

      return {
        event: eventName,
        allowed: false,
        reason: guardResult.reason ?? guard.reason ?? "guard_failed",
        source: "guard",
        ...describeCurrentTransitionState(transition, storeOverride),
        ...metadata
      };
    }

    if (!transition) {
      return {
        event: eventName,
        allowed: true,
        reason: "allowed",
        source: "guard",
        ...copyPublicLabel(guard)
      };
    }

    const transitionResult = explainTransition(eventName, transition, input, storeOverride, readonlyStore);
    if (!transitionResult.allowed) {
      return transitionResult;
    }

    return {
      ...transitionResult,
      ...(guard ? copyPublicLabel(guard) : {})
    };
  }

  function createReadonlyFlowReceiver(readonlyStore) {
    return {
      [FLOW_INSTANCE]: true,
      [FLOW_INSPECT]: describeFlow,
      store: readonlyStore,
      get refs() {
        return refs;
      },
      get asyncSignals() {
        return asyncSignals;
      },
      explain(eventName, nextInput, nextStore = readonlyStore, nextOptions = {}) {
        return explainEvent(eventName, nextInput, nextStore, nextOptions);
      }
    };
  }

  function explainGuard(guard, receiver, readonlyStore, input) {
    if (typeof guard.explain === "function") {
      const result = guard.explain.call(receiver, readonlyStore, input, undefined);
      if (result && typeof result === "object") {
        return {
          allowed: result.allowed === true,
          ...copyPublicMetadata(result),
          dynamicMetadata: result.dynamicMetadata === true
        };
      }
    }

    return {
      allowed: Boolean(guard.predicate.call(receiver, readonlyStore, input, undefined))
    };
  }

  function explainTransition(eventName, transition, input, sourceStore, readonlyStore) {
    const current = sourceStore[transition.status];
    let firstConditionFailure;

    for (const rule of transition.rules) {
      if (!matchesTransitionFrom(rule.from, current)) {
        continue;
      }

      if (
        typeof rule.when === "function" &&
        !rule.when.call(createReadonlyFlowReceiver(readonlyStore), readonlyStore, input, undefined)
      ) {
        firstConditionFailure ??= rule;
        continue;
      }

      const result = {
        event: eventName,
        allowed: true,
        reason: "allowed",
        source: "transition",
        status: transition.status,
        current: cloneInspectable(current),
        ...copyPublicLabel(rule)
      };

      if (typeof rule.to === "function") {
        result.dynamic = true;
      } else {
        result.next = cloneInspectable(rule.to);
      }

      return result;
    }

    if (firstConditionFailure) {
      return {
        event: eventName,
        allowed: false,
        reason: firstConditionFailure.reason ?? "transition_condition_failed",
        source: "transition",
        status: transition.status,
        current: cloneInspectable(current),
        ...copyPublicMetadata(firstConditionFailure)
      };
    }

    return {
      event: eventName,
      allowed: false,
      reason: "no_matching_transition",
      source: "transition",
      status: transition.status,
      current: cloneInspectable(current)
    };
  }

  function runFlowBatch(name, input, fn) {
    let result;
    const batch = createBatch(name, input);
    try {
      result = runInBatch(batch, fn);
    } catch (error) {
      finishBatch(batch);
      throw error;
    }

    finishBatch(batch);

    return result;
  }

  function runDispatchBatch(name, input, handler) {
    const batch = createBatch(name, input);
    const views = createFlowViews({
      store,
      refs,
      asyncSignals,
      internal,
      assertAlive,
      mutate: (fn) => runMutationInBatch(batch, fn),
      trackStop: trackSubscriberStop
    });
    const receiver = createHandlerReceiver(name, input, batch, views);

    let result;
    try {
      result = runInBatch(batch, () => {
        const next = handler.call(receiver, views.store, input);

        if (isPromiseLike(next)) {
          return next;
        }

        return applyHandlerResult(next, views.store);
      });
    } catch (error) {
      finishBatch(batch);
      throw error;
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (next) => {
          let applied;
          try {
            applied = runInBatch(batch, () => applyHandlerResult(next, views.store));
          } catch (error) {
            finishBatch(batch);
            throw error;
          }
          finishBatch(batch);
          return applied;
        },
        (error) => {
          finishBatch(batch);
          throw error;
        }
      );
    }

    finishBatch(batch);
    return result;
  }

  function createBatch(name, input) {
    return {
      name,
      input,
      changed: false,
      closed: false,
      mutationCount: 0,
      recordCount: 0,
      startSnapshot: storeState.snapshot()
    };
  }

  function runInBatch(batch, fn) {
    assertAlive();
    if (activeBatch === batch) {
      return fn();
    }

    if (batch.closed) {
      return scheduler.batch(fn);
    }

    const previousBatch = activeBatch;
    activeBatch = batch;
    try {
      return scheduler.batch(fn);
    } finally {
      activeBatch = previousBatch;
    }
  }

  function runMutationInBatch(batch, fn) {
    const result = runInBatch(batch, fn);
    if (!batch.closed) {
      batch.changed = true;
      batch.mutationCount += 1;
    }
    return result;
  }

  function finishBatch(batch) {
    if (batch.closed) {
      return;
    }
    batch.closed = true;

    if (batch.changed && !destroyed) {
      const snapshot = storeState.snapshot();
      const remainingRecords = Math.max(
        1,
        batch.mutationCount,
        countSnapshotChanges(batch.startSnapshot, snapshot)
      ) - batch.recordCount;
      if (remainingRecords > 0) {
        suppressedSnapshots.push({
          snapshot,
          remaining: remainingRecords
        });
      }
      notifyWholeSubscribers({
        name: batch.name,
        input: batch.input,
        store: snapshot
      });
    }
  }

  function recordChange() {
    if (activeBatch) {
      activeBatch.changed = true;
      activeBatch.recordCount += 1;
      return;
    }

    const snapshot = storeState.snapshot();
    const suppressed = findSuppressedSnapshot(snapshot);
    if (suppressed) {
      suppressed.remaining -= 1;
      if (suppressed.remaining <= 0) {
        suppressedSnapshots.splice(suppressedSnapshots.indexOf(suppressed), 1);
      }
      return;
    }

    notifyWholeSubscribers({
      store: snapshot
    });
  }

  function findSuppressedSnapshot(snapshot) {
    return suppressedSnapshots.find((entry) => areSnapshotsEqual(entry.snapshot, snapshot));
  }

  function notifyWholeSubscribers(change) {
    for (const subscriber of [...wholeSubscribers]) {
      subscriber(change);
    }
  }

  function applyHandlerResult(result, targetStore = store) {
    if (!isPlainObject(result)) {
      return result;
    }

    return applyStoreUpdates(result, targetStore);
  }

  function applyStoreUpdates(updates, targetStore = store) {
    for (const [name, value] of Object.entries(updates)) {
      assertWritable(refs, writableNames, name);
      targetStore[name] = value;
    }

    return updates;
  }

  return flow;
}

function createFlowViews({ store, refs, asyncSignals, internal, assertAlive, mutate, trackStop }) {
  const refCache = new Map();
  const viewOptions = { assertAlive, mutate, trackStop };
  const publicRefs = createRefViewNamespace(refs, viewOptions, refCache);
  const publicAsyncSignals = createRefViewNamespace(asyncSignals, viewOptions, refCache);
  const publicStore = createStoreMutationView(store, publicRefs, publicAsyncSignals, {
    assertAlive,
    mutate
  });
  const publicInternal = createInternalStoreMutationView(internal, publicRefs, publicAsyncSignals);

  return {
    store: publicStore,
    refs: publicRefs,
    asyncSignals: publicAsyncSignals,
    internal: publicInternal
  };
}

function createRefViewNamespace(entries, options, cache) {
  const namespace = {};

  for (const [name, ref] of Object.entries(entries)) {
    namespace[name] = createRefMutationView(ref, options, cache);
  }

  return namespace;
}

function createRefMutationView(ref, options, cache) {
  if (cache.has(ref)) {
    return cache.get(ref);
  }

  const view = new Proxy(ref, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === "subscribe") {
        if (typeof value !== "function") {
          return value;
        }

        return (fn) => {
          options.assertAlive();
          const stop = value.call(target, fn);
          return options.trackStop(stop);
        };
      }

      if (isRefMutationMethod(prop)) {
        if (typeof value !== "function") {
          return value;
        }

        return (...args) => {
          options.assertAlive();
          return options.mutate(() => value.apply(target, args));
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },

    set(target, prop, value, receiver) {
      options.assertAlive();
      return options.mutate(() => Reflect.set(target, prop, value, receiver));
    }
  });

  cache.set(ref, view);
  return view;
}

function createStoreMutationView(store, refs, asyncSignals, options) {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (typeof prop !== "symbol" && isInternalStoreName(prop)) {
        return refs[prop] ?? asyncSignals[prop] ?? Reflect.get(target, prop, receiver);
      }

      return Reflect.get(target, prop, receiver);
    },

    set(target, prop, value, receiver) {
      options.assertAlive();
      return options.mutate(() => Reflect.set(target, prop, value, receiver));
    },

    deleteProperty() {
      options.assertAlive();
      return false;
    }
  });
}

function createInternalStoreMutationView(internal, refs, asyncSignals) {
  const namespace = {};

  for (const name of Object.keys(internal)) {
    const ref = refs[name] ?? asyncSignals[name];

    if (ref) {
      Object.defineProperty(namespace, name, {
        configurable: false,
        enumerable: true,
        value: ref,
        writable: false
      });
      continue;
    }

    Object.defineProperty(namespace, name, {
      configurable: false,
      enumerable: true,
      get() {
        return internal[name];
      }
    });
  }

  return Object.freeze(namespace);
}

function isRefMutationMethod(prop) {
  return (
    prop === "set" ||
    prop === "update" ||
    prop === "restore" ||
    prop === "load" ||
    prop === "reload" ||
    prop === "cancel"
  );
}

function countSnapshotChanges(before, after) {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {})
  ]);
  let changes = 0;

  for (const key of keys) {
    if (!areSnapshotsEqual(before?.[key], after?.[key])) {
      changes += 1;
    }
  }

  return changes;
}

function areSnapshotsEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => areSnapshotsEqual(value, right[index]));
  }

  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) =>
    Object.hasOwn(right, key) && areSnapshotsEqual(left[key], right[key])
  );
}

function createWritableRefForDeclaration(name, declaration, scheduler) {
  if (isStatusDefinition(declaration)) {
    return createStatus(declaration.initial, declaration.allowed, {
      name,
      scheduler
    });
  }

  if (isStatusLike(declaration)) {
    return declaration;
  }

  if (isSignalDefinition(declaration)) {
    return createSignal(declaration.initial, { scheduler });
  }

  if (isSignalLike(declaration)) {
    return declaration;
  }

  return createSignal(declaration, { scheduler });
}

function createStoreProxy(refs, asyncSignals, plainValues, writableNames) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") {
          return undefined;
        }

        const entry = refs[prop] ?? asyncSignals[prop];

        if (entry?.[ASYNC_SIGNAL] && isInternalStoreName(prop)) {
          return entry;
        }

        if (entry?.[SIGNAL] || entry?.[STATUS] || entry?.[COMPUTED] || entry?.[ASYNC_SIGNAL]) {
          return entry.get();
        }

        return plainValues[prop];
      },

      set(_target, prop, value) {
        if (typeof prop === "symbol") {
          return false;
        }

        const entry = refs[prop] ?? asyncSignals[prop];

        if (entry?.[STATUS]) {
          entry.set(value);
          return true;
        }

        if (entry?.[SIGNAL] || entry?.[ASYNC_SIGNAL]) {
          entry.set(value);
          return true;
        }

        if (entry?.[COMPUTED]) {
          throw new Error("Computed store values are read-only.");
        }

        if (!Object.hasOwn(plainValues, prop)) {
          throw new Error(`Unknown Flow store value "${prop}".`);
        }

        plainValues[prop] = value;
        writableNames.add(prop);
        return true;
      },

      has(_target, prop) {
        return Object.hasOwn(refs, prop) || Object.hasOwn(asyncSignals, prop) || Object.hasOwn(plainValues, prop);
      },

      ownKeys() {
        return [...new Set([
          ...Object.keys(refs),
          ...Object.keys(asyncSignals),
          ...Object.keys(plainValues)
        ])];
      },

      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === "symbol") {
          return undefined;
        }

        if (
          Object.hasOwn(refs, prop) ||
          Object.hasOwn(asyncSignals, prop) ||
          Object.hasOwn(plainValues, prop)
        ) {
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

function createInternalStoreNamespace(refs, asyncSignals, plainValues) {
  const namespace = {};
  const names = new Set([
    ...Object.keys(refs),
    ...Object.keys(asyncSignals),
    ...Object.keys(plainValues)
  ]);

  for (const name of names) {
    if (!isInternalStoreName(name)) {
      continue;
    }

    if (asyncSignals[name]) {
      Object.defineProperty(namespace, name, {
        configurable: false,
        enumerable: true,
        value: asyncSignals[name],
        writable: false
      });
      continue;
    }

    if (refs[name]) {
      Object.defineProperty(namespace, name, {
        configurable: false,
        enumerable: true,
        value: refs[name],
        writable: false
      });
      continue;
    }

    Object.defineProperty(namespace, name, {
      configurable: false,
      enumerable: true,
      get() {
        return plainValues[name];
      }
    });
  }

  return Object.freeze(namespace);
}

function describeTransitionRule(rule) {
  const description = {
    conditional: typeof rule.when === "function",
    ...copyPublicMetadata(rule)
  };

  if (rule.from !== undefined) {
    description.from = cloneInspectable(rule.from);
  }

  if (typeof rule.to === "function") {
    description.dynamic = true;
  } else {
    description.to = cloneInspectable(rule.to);
  }

  return description;
}

function copyPublicMetadata(source) {
  const metadata = {};

  if (typeof source?.reason === "string") {
    metadata.reason = source.reason;
  }

  if (typeof source?.label === "string") {
    metadata.label = source.label;
  }

  return metadata;
}

function copyPublicLabel(source) {
  return typeof source?.label === "string"
    ? { label: source.label }
    : {};
}

function describeCurrentTransitionState(transition, store) {
  if (!transition) {
    return {};
  }

  return {
    status: transition.status,
    current: cloneInspectable(store[transition.status])
  };
}

function createReadonlyStoreView(store) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return cloneInspectable(store[prop]);
      },
      set() {
        return true;
      },
      has(_target, prop) {
        return prop in store;
      },
      ownKeys() {
        return Reflect.ownKeys(store);
      },
      getOwnPropertyDescriptor(_target, prop) {
        const descriptor = Object.getOwnPropertyDescriptor(store, prop);
        if (!descriptor) {
          return undefined;
        }

        return {
          configurable: true,
          enumerable: descriptor.enumerable
        };
      }
    }
  );
}

function matchesTransitionFrom(from, current) {
  if (from === undefined) {
    return true;
  }

  return Array.isArray(from)
    ? from.some((value) => Object.is(value, current))
    : Object.is(from, current);
}

function cloneInspectable(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall back to a small structural clone for common inspectable values.
    }
  }

  if (Array.isArray(value)) {
    return value.map(cloneInspectable);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, cloneInspectable(entry)])
    );
  }

  return value;
}

function isComputedDeclaration(value) {
  return typeof value === "function" || isComputedDefinition(value);
}

function isBrandedStoreEntry(value) {
  return (
    isSignalDefinition(value) ||
    isSignalLike(value) ||
    isStatusDefinition(value) ||
    isStatusLike(value) ||
    isComputedDefinition(value) ||
    isAsyncSignalLike(value)
  );
}

function isSignalLike(value) {
  return Boolean(value && typeof value === "object" && value[SIGNAL]);
}

function isStatusLike(value) {
  return Boolean(value && typeof value === "object" && value[STATUS]);
}

function isAsyncSignalLike(value) {
  return Boolean(value && typeof value === "object" && value[ASYNC_SIGNAL]);
}

function isAccessorDescriptor(descriptor) {
  return Object.hasOwn(descriptor, "get") || Object.hasOwn(descriptor, "set");
}

function isInternalStoreName(name) {
  return typeof name === "string" && name.startsWith("_");
}

function normalizeCreateComputedArgs(optionsOrCompute, maybeCompute, maybeRuntimeOptions) {
  if (typeof optionsOrCompute === "function") {
    return {
      options: {},
      compute: optionsOrCompute,
      runtimeOptions: isPlainObject(maybeCompute) ? maybeCompute : {}
    };
  }

  if (!isPlainObject(optionsOrCompute)) {
    throw new TypeError("createComputed(...) options must be an object when provided.");
  }

  if (Object.hasOwn(optionsOrCompute, "arguments")) {
    assertValidConfiguredArguments("createComputed", optionsOrCompute.arguments);
  }

  if (typeof maybeCompute !== "function") {
    throw new TypeError("createComputed(...) requires a compute function.");
  }

  return {
    options: { ...optionsOrCompute },
    compute: maybeCompute,
    runtimeOptions: isPlainObject(maybeRuntimeOptions) ? maybeRuntimeOptions : {}
  };
}

function normalizeCreateAsyncSignalArgs(optionsOrLoader, maybeLoader, maybeRuntimeOptions) {
  if (isAsyncSignalDefinition(optionsOrLoader)) {
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
    throw new TypeError("createAsyncSignal(...) options must be an object when provided.");
  }

  if (Object.hasOwn(optionsOrLoader, "arguments")) {
    assertValidConfiguredArguments("createAsyncSignal", optionsOrLoader.arguments);
  }

  if (typeof maybeLoader !== "function") {
    throw new TypeError("createAsyncSignal(...) requires a loader function.");
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

function resolveConfiguredArguments(name, configured, store, explicitArgs = []) {
  if (explicitArgs.length > 0) {
    return [...explicitArgs];
  }

  if (configured === undefined) {
    return [];
  }

  if (Array.isArray(configured)) {
    return [...configured];
  }

  if (typeof configured === "function") {
    const resolved = configured(store);
    if (!Array.isArray(resolved)) {
      throw new TypeError(`${name}(...) options.arguments function must return an array.`);
    }

    return [...resolved];
  }

  throw new TypeError(`${name}(...) options.arguments must be an array or function when provided.`);
}

function assertValidConfiguredArguments(name, value) {
  if (Array.isArray(value) || typeof value === "function") {
    return;
  }

  throw new TypeError(`${name}(...) options.arguments must be an array or function when provided.`);
}

function createComputedReceiver(options) {
  const context = options.context ?? {};

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "store") {
          return options.store;
        }

        if (prop === "refs") {
          return options.refs;
        }

        if (hasStoreValue(options.store, prop)) {
          return options.store[prop];
        }

        if (Object.hasOwn(context, prop)) {
          return context[prop];
        }

        if (prop === "name") {
          return options.name;
        }

        return undefined;
      },

      set(_target, prop, value) {
        if (hasStoreValue(options.store, prop)) {
          options.store[prop] = value;
          return true;
        }

        return false;
      },

      has(_target, prop) {
        return (
          prop === "store" ||
          prop === "refs" ||
          prop === "name" ||
          hasStoreValue(options.store, prop) ||
          Object.hasOwn(context, prop)
        );
      }
    }
  );
}

function hasStoreValue(store, prop) {
  return typeof prop !== "symbol" && store !== undefined && prop in store;
}

function createAsyncSignalReceiver(options) {
  return {
    store: options.store,
    refs: options.refs,
    asyncSignals: options.asyncSignals,
    name: options.name,
    signal: options.signal,
    version: options.version,
    args: [...options.args]
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

function assertKnownStoreValue(refs, asyncSignals, name) {
  if (!Object.hasOwn(refs, name) && !Object.hasOwn(asyncSignals, name)) {
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

function resolveRuntimeScheduler(options = {}) {
  const scheduler = options.scheduler ?? immediateScheduler;
  validateScheduler(scheduler);
  return scheduler;
}

function validateScheduler(scheduler) {
  if (!scheduler || typeof scheduler.batch !== "function") {
    throw new TypeError("Flow scheduler requires a batch(fn) function.");
  }

  if (scheduler.enqueue !== undefined && typeof scheduler.enqueue !== "function") {
    throw new TypeError("Flow scheduler enqueue must be a function when provided.");
  }

  if (scheduler.flush !== undefined && typeof scheduler.flush !== "function") {
    throw new TypeError("Flow scheduler flush must be a function when provided.");
  }
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
