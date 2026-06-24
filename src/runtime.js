import {
  COMPUTED,
  ASYNC_SIGNAL,
  ASYNC_SIGNAL_IMMEDIATE,
  SIGNAL,
  STATUS,
  defineFlow,
  isComputedDefinition,
  isFlowDefinition,
  isPlainObject,
  isAsyncSignalDefinition,
  isSignalDefinition,
  isStatusDefinition
} from "./define.js";
import { COMPOSE_BATCH, isPromiseLike } from "./compose.js";
import { resolveScheduler } from "./scheduler.js";

const TRANSITION = Symbol.for("@async/flow.transition");
const GUARD = Symbol.for("@async/flow.guard");
export const FLOW_INSTANCE = Symbol.for("@async/flow.instance");

const RESERVED_INSTANCE_NAMES = new Set([
  "_",
  "get",
  "set",
  "update",
  "subscribe",
  "dispatch",
  "can",
  "describe",
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

export function createComputed(optionsOrCompute, maybeCompute, maybeRuntimeOptions) {
  const { options, compute, runtimeOptions } = normalizeCreateComputedArgs(
    optionsOrCompute,
    maybeCompute,
    maybeRuntimeOptions
  );

  if (typeof compute !== "function") {
    throw new TypeError("Computed store value requires a function.");
  }

  const scheduler = resolveScheduler(runtimeOptions);
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

export function createAsyncSignal(optionsOrLoader, maybeLoader, maybeRuntimeOptions) {
  const { options, loader, runtimeOptions } = normalizeCreateAsyncSignalArgs(
    optionsOrLoader,
    maybeLoader,
    maybeRuntimeOptions
  );
  const scheduler = resolveScheduler(runtimeOptions);
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
    kind: "asyncSignal",

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
        asyncSignalRef.load();
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
    asyncSignalRef.load();
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

export function createStore(declarations = {}, options = {}) {
  if (!isPlainObject(declarations)) {
    throw new TypeError("createStore(...) requires a store declaration object.");
  }

  const scheduler = resolveScheduler(options);
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
  const scheduler = resolveScheduler(runtimeOptions);
  const handlers = {};
  const rawHandlers = {};
  const transitionMetadata = new Map();
  const guardMetadata = new Map();
  const wholeSubscribers = new Set();
  const refStops = [];
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

  const declaredStatusNames = Object.entries(Object.getOwnPropertyDescriptors(definition.store))
    .filter(([, descriptor]) => "value" in descriptor && isStatusDefinition(descriptor.value))
    .map(([name]) => name);

  const storeState = createStore(definition.store, {
    scheduler,
    rejectPlainObjects: true,
    context: {
      describe: () => ({
        statuses: declaredStatusNames,
        transitions: Object.fromEntries(transitionMetadata),
        handlers: Object.keys(definition.on)
      }),
      explain: (eventName, input, storeOverride, options) =>
        explainEvent(eventName, input, storeOverride, options),
      transition: (eventName) => transitionMetadata.get(eventName)
    }
  });
  const { store, refs, asyncSignals, internal, writableNames, statusNames } = storeState;

  flow = {
    store,
    refs,
    asyncSignals,
    handlers,

    get(name) {
      assertKnownStoreValue(refs, asyncSignals, name);
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

      assertKnownStoreValue(refs, asyncSignals, nameOrFn);
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

      const receiver = createHandlerReceiver(name, input);
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

    can(eventName, input) {
      return flow.explain(eventName, input).allowed;
    },

    explain(eventName, input) {
      return explainEvent(eventName, input);
    },

    describe() {
      return describeFlow();
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
        guards: Object.fromEntries(guardMetadata),
        store: Object.keys(refs),
        asyncSignals: Object.keys(asyncSignals),
        handlers: Object.keys(handlers)
      };
    }
  };

  Object.defineProperty(flow, "_", {
    configurable: false,
    enumerable: false,
    value: internal,
    writable: false
  });

  Object.defineProperty(flow, FLOW_INSTANCE, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });

  for (const [name, ref] of Object.entries(refs)) {
    refStops.push(ref.subscribe((value) => recordChange(name, value)));
  }

  for (const [name, asyncSignalRef] of Object.entries(asyncSignals)) {
    if (refs[name] === asyncSignalRef) {
      continue;
    }

    refStops.push(asyncSignalRef.subscribe(() => recordChange(name, store[name])));
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

  function createHandlerReceiver(name, input) {
    const receiver = {
      store,
      refs,
      asyncSignals,
      dispatch: flow.dispatch.bind(flow),
      can: flow.can.bind(flow),
      explain: flow.explain.bind(flow),
      describe: flow.describe.bind(flow),
      [COMPOSE_BATCH](fn) {
        return runFlowBatch(name, input, fn);
      },
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
        kind: ref.kind,
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
        kind: "asyncSignal",
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
      store: readonlyStore,
      get refs() {
        return refs;
      },
      get asyncSignals() {
        return asyncSignals;
      },
      can(eventName, nextInput) {
        return explainEvent(eventName, nextInput, readonlyStore).allowed;
      },
      explain(eventName, nextInput, nextStore = readonlyStore, nextOptions = {}) {
        return explainEvent(eventName, nextInput, nextStore, nextOptions);
      },
      describe: describeFlow,
      _describe() {
        return flow?._describe?.() ?? {
          statuses: [...declaredStatusNames],
          transitions: Object.fromEntries(transitionMetadata),
          guards: Object.fromEntries(guardMetadata),
          handlers: Object.keys(definition.on)
        };
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
  return isSignalDefinition(value) || isStatusDefinition(value) || isComputedDefinition(value) || isAsyncSignalLike(value);
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
