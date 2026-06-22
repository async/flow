export const FLOW_DEFINITION = "async.flow.definition";
export const SIGNAL_DEFINITION = "async.flow.signal";
export const COMPUTED_DEFINITION = "async.flow.computed";
export const STATUS_DEFINITION = "async.flow.status";

export const SIGNAL = Symbol.for("@async/flow.signal");
export const STATUS = Symbol.for("@async/flow.status");
export const COMPUTED = Symbol.for("@async/flow.computed");
export const RESOURCE = Symbol.for("@async/flow.resource");
export const RESOURCE_IMMEDIATE = Symbol.for("@async/flow.resource.immediate");

export function defineSignal(initial) {
  return {
    kind: SIGNAL_DEFINITION,
    initial
  };
}

export function defineStatus(initial, allowed) {
  if (allowed !== undefined && (!Array.isArray(allowed) || allowed.length === 0)) {
    throw new TypeError("status(...) allowed values must be a non-empty array when provided.");
  }

  if (allowed !== undefined && !allowed.some((value) => Object.is(value, initial))) {
    throw new Error("status(...) initial value must be present in the allowed values.");
  }

  return {
    kind: STATUS_DEFINITION,
    initial,
    allowed: allowed === undefined ? undefined : [...allowed]
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

export function defineFlow(config = {}) {
  if (isFlowDefinition(config)) {
    return config;
  }

  if (!isPlainObject(config)) {
    throw new TypeError("defineFlow(...) requires a configuration object.");
  }

  if (Object.hasOwn(config, "signals")) {
    throw new TypeError('Flow "signals" has been replaced by "store".');
  }

  const store = config.store ?? {};
  const on = config.on ?? {};

  if (!isPlainObject(store)) {
    throw new TypeError('Flow "store" must be an object.');
  }

  if (!isPlainObject(on)) {
    throw new TypeError('Flow "on" must be an object.');
  }

  for (const [name, handler] of Object.entries(on)) {
    if (Array.isArray(handler)) {
      throw new TypeError(
        `Flow handler "${name}" is an array. Use compose([...]) to create a handler function.`
      );
    }

    if (typeof handler !== "function") {
      throw new TypeError(`Flow handler "${name}" must be a function.`);
    }
  }

  return {
    kind: FLOW_DEFINITION,
    store: { ...store },
    on: { ...on }
  };
}

export function isFlowDefinition(value) {
  return isPlainObject(value) && value.kind === FLOW_DEFINITION;
}

export function isSignalDefinition(value) {
  return isPlainObject(value) && value.kind === SIGNAL_DEFINITION;
}

export function isStatusDefinition(value) {
  return isPlainObject(value) && value.kind === STATUS_DEFINITION;
}

export function isComputedDefinition(value) {
  return isPlainObject(value) && value.kind === COMPUTED_DEFINITION;
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
export const status = defineStatus;
