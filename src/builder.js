import { compose, parallel } from "./compose.js";
import { defineSignal, defineStatus, isPlainObject } from "./define.js";
import { after, dispatch, set, transition, when } from "./helpers/core.js";

export function toFlowConfig(graph, bindings = {}, options = {}) {
  assertGraph(graph);
  assertBindings(bindings);
  assertOptions(options);

  const context = createCompileContext(graph, bindings, options);
  const store = compileStore(graph.store, context);
  const on = compileEvents(graph.on, context);

  assertUnusedBindings(context);

  return {
    store,
    on
  };
}

function compileStore(storeGraph, context) {
  const store = {};

  for (const [name, entry] of Object.entries(storeGraph)) {
    assertIdentifier(name, "store name");

    if (!isRecord(entry) || typeof entry.type !== "string") {
      throw new TypeError(`Flow builder store "${name}" requires a typed entry.`);
    }

    if (entry.type === "status") {
      const states = normalizeStates(entry.states, `store "${name}"`);
      const initial = requireOwn(entry, "initial", `store "${name}"`);

      if (!states.some((state) => Object.is(state, initial))) {
        throw new Error(`Flow builder status "${name}" initial value must be present in states.`);
      }

      context.statuses[name] = new Set(states);
      store[name] = defineStatus(initial, states);
      continue;
    }

    if (entry.type === "signal") {
      store[name] = defineSignal(requireOwn(entry, "initial", `store "${name}"`));
      continue;
    }

    throw new TypeError(`Flow builder store "${name}" has unknown type "${entry.type}".`);
  }

  return store;
}

function compileEvents(eventsGraph, context) {
  const on = {};

  for (const [name, stepOrSteps] of Object.entries(eventsGraph)) {
    assertIdentifier(name, "event name");
    const steps = normalizeSteps(stepOrSteps, `event "${name}"`);
    const compiled = steps.map((step, index) => compileStep(step, context, `${name}[${index}]`));

    on[name] = compiled.length === 1 ? compiled[0] : compose(compiled);
  }

  return on;
}

function compileStep(step, context, path) {
  if (!isRecord(step) || typeof step.type !== "string") {
    throw new TypeError(`Flow builder step ${path} requires a typed entry.`);
  }

  if (step.type === "transition") {
    const statusName = requireString(step, "status", path);
    assertKnownStatus(context, statusName, path);
    const rule = {
      from: Object.hasOwn(step, "from") ? step.from : undefined,
      to: requireOwn(step, "to", path),
      ...copyMetadata(step)
    };

    assertTransitionValue(context, statusName, rule.from, `${path}.from`, true);
    assertTransitionValue(context, statusName, rule.to, `${path}.to`, false);
    return transition(statusName, rule);
  }

  if (step.type === "guard") {
    return when(compileGuardPredicate(step, context, path), {
      availability: true,
      ...copyMetadata(step)
    });
  }

  if (step.type === "handler") {
    const handlerName = requireString(step, "handler", path);
    const handler = requireHandler(context, handlerName, path);
    context.usedHandlers.add(handlerName);

    return function boundHandler(store, input, previous) {
      return handler.call(createBindingReceiver(this, context.bindings), store, input, previous);
    };
  }

  if (step.type === "set") {
    const target = requireString(step, "target", path);

    if (Object.hasOwn(step, "from")) {
      const source = requireString(step, "from", path);
      return set(target, (store) => store[source]);
    }

    if (Object.hasOwn(step, "value")) {
      return set(target, step.value);
    }

    throw new TypeError(`Flow builder set step ${path} requires "value" or "from".`);
  }

  if (step.type === "dispatch") {
    return dispatch(
      requireString(step, "event", path),
      Object.hasOwn(step, "input") ? step.input : undefined
    );
  }

  if (step.type === "after") {
    return after(
      requireNumber(step, "ms", path),
      requireString(step, "event", path),
      Object.hasOwn(step, "input") ? step.input : undefined
    );
  }

  if (step.type === "parallel") {
    const steps = normalizeSteps(step.steps, `${path}.steps`);
    return parallel(steps.map((entry, index) => compileStep(entry, context, `${path}.steps[${index}]`)));
  }

  throw new TypeError(`Flow builder step ${path} has unknown type "${step.type}".`);
}

function compileGuardPredicate(step, context, path) {
  if (Object.hasOwn(step, "handler")) {
    const handlerName = requireString(step, "handler", path);
    const handler = requireHandler(context, handlerName, path);
    context.usedHandlers.add(handlerName);

    return function handlerGuard(store, input, previous) {
      return Boolean(handler.call(createBindingReceiver(this, context.bindings), store, input, previous));
    };
  }

  if (Object.hasOwn(step, "signal")) {
    const signalName = requireString(step, "signal", path);
    const signal = requireSignal(context, signalName, path);
    context.usedSignals.add(signalName);

    return function signalGuard(store, input, previous) {
      return Boolean(readExternalSignal(signal, createBindingReceiver(this, context.bindings), store, input, previous));
    };
  }

  throw new TypeError(`Flow builder guard step ${path} requires "handler" or "signal".`);
}

function createCompileContext(graph, bindings, options) {
  return {
    graph,
    bindings: {
      handlers: bindings.handlers ?? {},
      signals: bindings.signals ?? {}
    },
    options,
    statuses: {},
    usedHandlers: new Set(),
    usedSignals: new Set()
  };
}

function assertGraph(graph) {
  if (!isRecord(graph)) {
    throw new TypeError("toFlowConfig(...) requires a graph object.");
  }

  if (!isRecord(graph.store)) {
    throw new TypeError('Flow builder graph requires a "store" object.');
  }

  if (!isRecord(graph.on)) {
    throw new TypeError('Flow builder graph requires an "on" object.');
  }
}

function assertBindings(bindings) {
  if (!isRecord(bindings)) {
    throw new TypeError("toFlowConfig(...) bindings must be an object.");
  }

  if (bindings.handlers !== undefined && !isRecord(bindings.handlers)) {
    throw new TypeError('Flow builder bindings "handlers" must be an object.');
  }

  if (bindings.signals !== undefined && !isRecord(bindings.signals)) {
    throw new TypeError('Flow builder bindings "signals" must be an object.');
  }
}

function assertOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("toFlowConfig(...) options must be an object.");
  }
}

function assertUnusedBindings(context) {
  if (context.options.strict !== true) {
    return;
  }

  const unusedHandlers = Object.keys(context.bindings.handlers)
    .filter((name) => !context.usedHandlers.has(name));
  if (unusedHandlers.length > 0) {
    throw new Error(`Flow builder unused handlers: ${unusedHandlers.join(", ")}.`);
  }

  const unusedSignals = Object.keys(context.bindings.signals)
    .filter((name) => !context.usedSignals.has(name));
  if (unusedSignals.length > 0) {
    throw new Error(`Flow builder unused signals: ${unusedSignals.join(", ")}.`);
  }
}

function requireHandler(context, name, path) {
  const handler = context.bindings.handlers[name];

  if (typeof handler !== "function") {
    throw new Error(`Flow builder step ${path} references missing handler "${name}".`);
  }

  return handler;
}

function requireSignal(context, name, path) {
  if (!Object.hasOwn(context.bindings.signals, name)) {
    throw new Error(`Flow builder step ${path} references missing signal "${name}".`);
  }

  return context.bindings.signals[name];
}

function assertKnownStatus(context, name, path) {
  if (!Object.hasOwn(context.statuses, name)) {
    throw new Error(`Flow builder step ${path} references unknown status "${name}".`);
  }
}

function assertTransitionValue(context, statusName, value, path, optional) {
  if (value === undefined && optional) {
    return;
  }

  const allowed = context.statuses[statusName];
  for (const entry of normalizeValueList(value)) {
    if (!allowed.has(entry)) {
      throw new Error(`Flow builder transition ${path} value is not in status "${statusName}" states.`);
    }
  }
}

function normalizeStates(states, path) {
  if (!Array.isArray(states) || states.length === 0) {
    throw new TypeError(`Flow builder ${path} requires a non-empty states array.`);
  }

  return [...states];
}

function normalizeSteps(stepOrSteps, path) {
  const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];

  if (steps.length === 0) {
    throw new TypeError(`Flow builder ${path} requires at least one step.`);
  }

  return steps;
}

function requireOwn(object, name, path) {
  if (!Object.hasOwn(object, name)) {
    throw new TypeError(`Flow builder ${path} requires "${name}".`);
  }

  return object[name];
}

function requireString(object, name, path) {
  const value = requireOwn(object, name, path);

  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Flow builder ${path} "${name}" must be a non-empty string.`);
  }

  return value;
}

function requireNumber(object, name, path) {
  const value = requireOwn(object, name, path);

  if (!Number.isFinite(value)) {
    throw new TypeError(`Flow builder ${path} "${name}" must be a finite number.`);
  }

  return value;
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Flow builder ${label} must be a non-empty string.`);
  }
}

function copyMetadata(step) {
  const metadata = {};

  if (typeof step.reason === "string") {
    metadata.reason = step.reason;
  }

  if (typeof step.label === "string") {
    metadata.label = step.label;
  }

  return metadata;
}

function createBindingReceiver(receiver, bindings) {
  const bound = Object.create(receiver ?? null);

  Object.defineProperty(bound, "handlers", {
    configurable: true,
    enumerable: true,
    value: bindings.handlers
  });

  Object.defineProperty(bound, "signals", {
    configurable: true,
    enumerable: true,
    value: bindings.signals
  });

  return bound;
}

function readExternalSignal(signal, receiver, store, input, previous) {
  if (typeof signal === "function") {
    return signal.call(receiver, store, input, previous);
  }

  if (signal !== null && typeof signal === "object") {
    if (typeof signal.get === "function") {
      return signal.get();
    }

    if (Object.hasOwn(signal, "value")) {
      return signal.value;
    }
  }

  return signal;
}

function normalizeValueList(value) {
  return Array.isArray(value) ? value : [value];
}

function isRecord(value) {
  return isPlainObject(value);
}
