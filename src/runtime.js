import {
  ASYNC_SIGNAL_DEFINITION,
  COMPUTED_DEFINITION,
  SIGNAL_DEFINITION,
  defineFlow,
  isAsyncSignalDefinition,
  isComputedDefinition,
  isFlowDefinition,
  isPlainObject,
  isSignalDefinition,
  isStateDefinition
} from "./define.js";
import { isPromiseLike, isRunStop } from "./run.js";
import { resolveScheduler } from "./scheduler.js";

const RESERVED_INSTANCE_NAMES = new Set([
  "get",
  "set",
  "update",
  "subscribe",
  "run",
  "snapshot",
  "restore",
  "destroy",
  "signals",
  "refs",
  "handlers"
]);

const dependencyStack = [];

export function createSignal(initial, options = {}) {
  const scheduler = resolveScheduler(options);
  const subscribers = new Set();
  let value = initial;
  let notifyScheduled = false;

  const ref = {
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

export function createComputed(compute, options = {}) {
  if (typeof compute !== "function") {
    throw new TypeError("Computed signal requires a function.");
  }

  const scheduler = resolveScheduler(options);
  const subscribers = new Set();
  let value;
  let initialized = false;
  let dependencyStops = [];
  let notifyScheduled = false;

  const ref = {
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

export function createAsyncSignal(loader, options = {}) {
  if (typeof loader !== "function") {
    throw new TypeError("Async signal requires a loader function.");
  }

  const scheduler = resolveScheduler(options);
  const hasInitial = Object.hasOwn(options, "initial");
  const value = createSignal(options.initial, { scheduler });
  const loading = createSignal(false, { scheduler });
  const error = createSignal(null, { scheduler });
  const ready = createSignal(hasInitial, { scheduler });

  function refresh(context = {}) {
    loading.set(true);
    error.set(null);

    let result;
    try {
      result = loader(context);
    } catch (caught) {
      loading.set(false);
      error.set(caught);
      ready.set(false);
      throw caught;
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (next) => {
          value.set(next);
          loading.set(false);
          ready.set(true);
          return next;
        },
        (caught) => {
          loading.set(false);
          error.set(caught);
          ready.set(false);
          throw caught;
        }
      );
    }

    value.set(result);
    loading.set(false);
    ready.set(true);
    return result;
  }

  return {
    kind: "asyncSignal",
    refs: {
      value,
      loading,
      error,
      ready
    },
    refresh
  };
}

export function createFlow(definitionOrConfig, options = {}) {
  const definition = isFlowDefinition(definitionOrConfig)
    ? definitionOrConfig
    : defineFlow(definitionOrConfig);
  const scheduler = resolveScheduler(options);
  const refs = {};
  const handlers = {};
  const rawHandlers = {};
  const writableNames = new Set();
  const stateNames = new Set();
  const transitionMetadata = new Map();
  const wholeSubscribers = new Set();
  const refStops = [];
  const computedEntries = [];
  const asyncDefinitions = [];
  let activeBatch = null;
  let destroyed = false;

  const signals = createSignalsProxy(refs, writableNames);

  const flow = {
    signals,
    refs,
    handlers,

    get(name) {
      assertKnownSignal(refs, name);
      return refs[name].get();
    },

    set(name, value) {
      assertWritable(refs, writableNames, name);
      return runFlowBatch(undefined, undefined, () => refs[name].set(value));
    },

    update(name, fn) {
      assertWritable(refs, writableNames, name);
      return runFlowBatch(undefined, undefined, () => refs[name].update(fn));
    },

    subscribe(nameOrFn, maybeFn) {
      if (typeof nameOrFn === "function") {
        wholeSubscribers.add(nameOrFn);
        return () => wholeSubscribers.delete(nameOrFn);
      }

      assertKnownSignal(refs, nameOrFn);
      return refs[nameOrFn].subscribe(maybeFn);
    },

    run(name, input) {
      if (destroyed) {
        throw new Error("Flow instance has been destroyed.");
      }

      const handler = rawHandlers[name];
      if (typeof handler !== "function") {
        throw new Error(`Unknown Flow handler "${name}".`);
      }

      const context = createHandlerContext(input);
      let result;

      result = runFlowBatch(name, input, () => {
        const next = handler(context);

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

      return applyHandlerResult(result);
    },

    snapshot() {
      const snapshot = {};

      for (const [name, ref] of Object.entries(refs)) {
        snapshot[name] = ref.snapshot();
      }

      return snapshot;
    },

    restore(snapshot) {
      if (!isPlainObject(snapshot)) {
        throw new TypeError("Flow restore(...) requires a snapshot object.");
      }

      runFlowBatch(undefined, undefined, () => {
        for (const [name, value] of Object.entries(snapshot)) {
          const ref = refs[name];

          if (ref?.kind === "signal") {
            ref.set(value);
          }
        }
      });
    },

    destroy() {
      destroyed = true;

      for (const stop of refStops.splice(0)) {
        stop();
      }

      wholeSubscribers.clear();
    },

    _describe() {
      return {
        writable: [...writableNames],
        states: [...stateNames],
        transitions: Object.fromEntries(transitionMetadata),
        signals: Object.keys(refs),
        handlers: Object.keys(handlers)
      };
    }
  };

  for (const [name, handler] of Object.entries(definition.on)) {
    if (handler?._flowTransition) {
      transitionMetadata.set(name, handler._flowTransition);
    }
  }

  for (const [name, declaration] of Object.entries(definition.signals)) {
    if (isComputedDeclaration(declaration)) {
      computedEntries.push([name, declaration]);
      continue;
    }

    if (isAsyncSignalDefinition(declaration)) {
      asyncDefinitions.push([name, declaration]);
      continue;
    }

    refs[name] = createWritableSignalForDeclaration(name, declaration, scheduler);
    writableNames.add(name);
    if (isStateDefinition(declaration)) {
      stateNames.add(name);
    }
  }

  for (const [name, declaration] of computedEntries) {
    const compute = typeof declaration === "function" ? declaration : declaration.compute;
    refs[name] = createComputed(() => compute(createHandlerContext(undefined)), {
      scheduler
    });
  }

  for (const [name, declaration] of asyncDefinitions) {
    mountAsyncSignal(name, declaration);
  }

  for (const [name, ref] of Object.entries(refs)) {
    refStops.push(ref.subscribe((value) => recordChange(name, value)));
  }

  for (const [name, handler] of Object.entries(definition.on)) {
    registerHandler(name, handler);
  }

  function mountAsyncSignal(name, declaration) {
    const family = createAsyncSignal(
      (context) => declaration.loader(context),
      {
        ...declaration.options,
        scheduler
      }
    );
    const refreshName = `refresh${capitalize(name)}`;

    refs[name] = family.refs.value;
    refs[`${name}.loading`] = family.refs.loading;
    refs[`${name}.error`] = family.refs.error;
    refs[`${name}.ready`] = family.refs.ready;
    writableNames.add(name);

    registerHandler(refreshName, (context) => {
      const result = family.refresh(context);

      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(() => undefined);
      }

      return undefined;
    });
  }

  function registerHandler(name, handler) {
    rawHandlers[name] = handler;
    handlers[name] = (input) => flow.run(name, input);
    handlers[name].raw = handler;

    if (!RESERVED_INSTANCE_NAMES.has(name) && !Object.hasOwn(flow, name)) {
      Object.defineProperty(flow, name, {
        configurable: true,
        enumerable: true,
        value(input) {
          return flow.run(name, input);
        }
      });
    }
  }

  function createHandlerContext(input) {
    return {
      flow,
      signals,
      refs,
      input
    };
  }

  function runFlowBatch(name, input, fn) {
    const previousBatch = activeBatch;
    const batch = {
      name,
      input,
      signals: {}
    };
    activeBatch = batch;

    let result;
    try {
      result = scheduler.batch(fn);
    } finally {
      activeBatch = previousBatch;
    }

    if (Object.keys(batch.signals).length > 0) {
      notifyWholeSubscribers({
        name,
        input,
        signals: batch.signals
      });
    }

    return result;
  }

  function recordChange(name, value) {
    if (activeBatch) {
      activeBatch.signals[name] = value;
      return;
    }

    notifyWholeSubscribers({
      signals: {
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

    return applySignalUpdates(result);
  }

  function applySignalUpdates(updates) {
    for (const [name, value] of Object.entries(updates)) {
      if (!Object.hasOwn(refs, name)) {
        throw new Error(`Flow handler returned unknown signal "${name}".`);
      }

      if (!writableNames.has(name)) {
        throw new Error(`Flow signal "${name}" is read-only.`);
      }

      refs[name].set(value);
    }

    return updates;
  }

  return flow;
}

function createWritableSignalForDeclaration(name, declaration, scheduler) {
  if (isStateDefinition(declaration)) {
    return createStateSignal(declaration.initial, declaration.allowed, {
      name,
      scheduler
    });
  }

  if (isSignalDefinition(declaration)) {
    return createSignal(declaration.initial, { scheduler });
  }

  if (
    isPlainObject(declaration) &&
    !isSignalDefinition(declaration) &&
    !isComputedDefinition(declaration) &&
    !isAsyncSignalDefinition(declaration)
  ) {
    throw new TypeError(
      `Flow signal "${name}" is a plain object. Nested signal objects are not supported in v1.\nWrap object values with signal(value).`
    );
  }

  return createSignal(declaration, { scheduler });
}

function createStateSignal(initial, allowed, options = {}) {
  const allowedValues = [...allowed];
  const ref = createSignal(initial, options);
  const setSignalValue = ref.set;

  ref.set = (next) => {
    assertAllowedStateValue(options.name, next, allowedValues);
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

function assertAllowedStateValue(name, value, allowedValues) {
  if (!allowedValues.some((allowed) => Object.is(allowed, value))) {
    throw new Error(
      `Invalid state value for Flow signal "${name}".`
    );
  }
}

function createSignalsProxy(refs, writableNames) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") {
          return undefined;
        }

        return refs[prop]?.get();
      },

      set(_target, prop, value) {
        if (typeof prop === "symbol") {
          return false;
        }

        assertWritable(refs, writableNames, prop);
        refs[prop].set(value);
        return true;
      },

      has(_target, prop) {
        return Object.hasOwn(refs, prop);
      },

      ownKeys() {
        return Reflect.ownKeys(refs);
      },

      getOwnPropertyDescriptor(_target, prop) {
        if (!Object.hasOwn(refs, prop)) {
          return undefined;
        }

        return {
          enumerable: true,
          configurable: true
        };
      }
    }
  );
}

function isComputedDeclaration(declaration) {
  return typeof declaration === "function" || isComputedDefinition(declaration);
}

function assertKnownSignal(refs, name) {
  if (!Object.hasOwn(refs, name)) {
    throw new Error(`Unknown Flow signal "${name}".`);
  }
}

function assertWritable(refs, writableNames, name) {
  assertKnownSignal(refs, name);

  if (!writableNames.has(name)) {
    throw new Error(`Flow signal "${name}" is read-only.`);
  }
}

function trackDependency(ref) {
  const current = dependencyStack.at(-1);

  if (current) {
    current.add(ref);
  }
}

function capitalize(value) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export {
  SIGNAL_DEFINITION,
  COMPUTED_DEFINITION,
  ASYNC_SIGNAL_DEFINITION
};
