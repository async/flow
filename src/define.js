export const FLOW_DEFINITION = "async.flow.definition";
export const SIGNAL_DEFINITION = "async.flow.signal";
export const COMPUTED_DEFINITION = "async.flow.computed";
export const ASYNC_SIGNAL_DEFINITION = "async.flow.asyncSignal";

export function defineSignal(initial) {
  return {
    kind: SIGNAL_DEFINITION,
    initial
  };
}

export function defineState(initial, allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new TypeError("state(...) requires a non-empty allowed values array.");
  }

  if (!allowed.some((value) => Object.is(value, initial))) {
    throw new Error("state(...) initial value must be present in the allowed values.");
  }

  return {
    kind: SIGNAL_DEFINITION,
    initial,
    state: true,
    allowed: [...allowed]
  };
}

export function defineComputed(compute) {
  if (typeof compute !== "function") {
    throw new TypeError("computed(...) requires a function.");
  }

  return {
    kind: COMPUTED_DEFINITION,
    compute
  };
}

export function defineAsyncSignal(loader, options = {}) {
  if (typeof loader !== "function") {
    throw new TypeError("asyncSignal(...) requires a loader function.");
  }

  return {
    kind: ASYNC_SIGNAL_DEFINITION,
    loader,
    options: { ...options }
  };
}

export function defineFlow(config = {}) {
  if (isFlowDefinition(config)) {
    return config;
  }

  if (!isPlainObject(config)) {
    throw new TypeError("defineFlow(...) requires a configuration object.");
  }

  const signals = config.signals ?? {};
  const on = config.on ?? {};

  if (!isPlainObject(signals)) {
    throw new TypeError('Flow "signals" must be an object.');
  }

  if (!isPlainObject(on)) {
    throw new TypeError('Flow "on" must be an object.');
  }

  for (const [name, handler] of Object.entries(on)) {
    if (Array.isArray(handler)) {
      throw new TypeError(
        `Flow handler "${name}" is an array. Use run([...]) to create a handler function.`
      );
    }

    if (typeof handler !== "function") {
      throw new TypeError(`Flow handler "${name}" must be a function.`);
    }
  }

  return {
    kind: FLOW_DEFINITION,
    signals: { ...signals },
    on: { ...on }
  };
}

export function isFlowDefinition(value) {
  return isPlainObject(value) && value.kind === FLOW_DEFINITION;
}

export function isSignalDefinition(value) {
  return isPlainObject(value) && value.kind === SIGNAL_DEFINITION;
}

export function isStateDefinition(value) {
  return isSignalDefinition(value) && value.state === true && Array.isArray(value.allowed);
}

export function isComputedDefinition(value) {
  return isPlainObject(value) && value.kind === COMPUTED_DEFINITION;
}

export function isAsyncSignalDefinition(value) {
  return isPlainObject(value) && value.kind === ASYNC_SIGNAL_DEFINITION;
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export const flow = defineFlow;
export const signal = defineSignal;
export const computed = defineComputed;
export const asyncSignal = defineAsyncSignal;
export const state = defineState;
