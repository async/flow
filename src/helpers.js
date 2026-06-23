import { defineComputed, defineStatus, isPlainObject } from "./define.js";
import { createComposeStop, isPromiseLike } from "./compose.js";

export const TRANSITION = Symbol.for("@async/flow.transition");
export const GUARD = Symbol.for("@async/flow.guard");

export const status = defineStatus;

export function set(nameOrUpdates, maybeValue) {
  return function setStep(store, input, previous) {
    const updates =
      typeof nameOrUpdates === "string"
        ? { [nameOrUpdates]: maybeValue }
        : nameOrUpdates;

    assertUpdateObject(updates, "set");

    for (const [name, value] of Object.entries(updates)) {
      store[name] = resolveStepValue(value, this, store, input, previous);
    }

    return undefined;
  };
}

export function dispatch(eventName, input) {
  assertEventName(eventName, "dispatch");

  return function dispatchStep(store, currentInput, previous) {
    assertFlowDispatchReceiver(this, "dispatch");
    return this.dispatch(eventName, resolveOptionalStepValue(input, this, store, currentInput, previous));
  };
}

export function after(ms, eventName, input) {
  assertDelay(ms, "after");
  assertEventName(eventName, "after");

  return function afterStep(store, currentInput, previous) {
    assertFlowAfterReceiver(this, "after");
    this.after(ms, eventName, resolveOptionalStepValue(input, this, store, currentInput, previous));
    return undefined;
  };
}

export function update(name, fn) {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("update(...) requires a store value name.");
  }

  if (typeof fn !== "function") {
    throw new TypeError("update(...) requires an updater function.");
  }

  return function updateStep(store, input, previous) {
    store[name] = fn(store[name], store, input, previous);
    return undefined;
  };
}

export function when(predicate) {
  if (typeof predicate !== "function") {
    throw new TypeError("when(...) requires a predicate function.");
  }

  return function whenStep(store, input, previous) {
    return predicate(store, input, previous) ? undefined : createComposeStop();
  };
}

export function branch(cases) {
  const normalized = normalizeBranchCases(cases);

  return function branchStep(store, input, previous) {
    for (const entry of normalized) {
      if (entry.default || entry.when.call(this, store, input, previous)) {
        return entry.then.call(this, store, input, previous);
      }
    }

    return undefined;
  };
}

export function onError(handle, handler) {
  if (typeof handle !== "function") {
    throw new TypeError("onError(...) requires an error handler function.");
  }

  if (typeof handler !== "function") {
    throw new TypeError("onError(...) requires a handler function.");
  }

  const onErrorStep = function onErrorStep(store, input, previous) {
    try {
      const result = handler.call(this, store, input, previous);

      if (isPromiseLike(result)) {
        return Promise.resolve(result).catch((error) =>
          handle.call(this, error, store, input, previous)
        );
      }

      return result;
    } catch (error) {
      return handle.call(this, error, store, input, previous);
    }
  };

  copyFlowMetadata(handler, onErrorStep);
  return onErrorStep;
}

export function guard(predicate, handler, options) {
  if (typeof predicate !== "function") {
    throw new TypeError("guard(...) requires a predicate function.");
  }

  if (typeof handler !== "function") {
    throw new TypeError("guard(...) requires a handler function.");
  }

  const metadata = normalizeMetadataOptions(options, "guard");

  const guardStep = function guardStep(store, input, previous) {
    if (!predicate.call(this, store, input, previous)) {
      return undefined;
    }

    return handler.call(this, store, input, previous);
  };

  copyFlowMetadata(handler, guardStep);
  Object.defineProperty(guardStep, GUARD, {
    configurable: true,
    value: {
      predicate,
      ...metadata
    }
  });
  return guardStep;
}

export function transition(statusName, config) {
  assertStatusName(statusName, "transition");
  const rules = normalizeTransitionRules(config);

  const transitionStep = function transitionStep(store, input, previous) {
    const name = resolveStatusName(this, statusName);
    const current = store[name];
    const rule = rules.find((entry) => transitionRuleMatches(entry, current, store, input, previous));

    if (!rule) {
      return undefined;
    }

    store[name] = typeof rule.to === "function"
      ? rule.to.call(this, store, input, previous)
      : rule.to;
    return undefined;
  };

  Object.defineProperty(transitionStep, TRANSITION, {
    configurable: true,
    value: {
      status: statusName,
      rules
    }
  });

  return transitionStep;
}

export function can(statusNameOrEventName, eventName) {
  if (arguments.length === 1) {
    assertEventName(statusNameOrEventName, "can");
    return defineComputed(function () {
      return Boolean(this.explain?.(statusNameOrEventName, undefined, this.store)?.allowed);
    });
  }

  assertStatusName(statusNameOrEventName, "can");
  if (typeof eventName !== "string" || eventName.length === 0) {
    throw new TypeError("can(...) requires an event name.");
  }

  return defineComputed(function () {
    const explanation = this.explain?.(eventName, undefined, this.store, {
      statusName: statusNameOrEventName
    });

    return Boolean(explanation?.allowed);
  });
}

export function matches(statusName, value) {
  assertStatusName(statusName, "matches");
  return defineComputed(function () {
    return Object.is(this.store[resolveStatusName(this, statusName)], value);
  });
}

function assertStatusName(value, helperName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${helperName}(...) requires a status name.`);
  }
}

function assertEventName(value, helperName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${helperName}(...) requires an event name.`);
  }
}

function assertDelay(value, helperName) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${helperName}(...) requires a non-negative millisecond delay.`);
  }
}

function assertFlowDispatchReceiver(receiver, helperName) {
  if (!receiver || typeof receiver.dispatch !== "function") {
    throw new TypeError(`${helperName}(...) requires a Flow handler receiver.`);
  }
}

function assertFlowAfterReceiver(receiver, helperName) {
  if (!receiver || typeof receiver.after !== "function") {
    throw new TypeError(`${helperName}(...) requires a Flow handler receiver.`);
  }
}

function assertUpdateObject(value, helperName) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${helperName}(...) requires a store update object.`);
  }
}

function resolveStepValue(value, receiver, store, input, previous) {
  return typeof value === "function"
    ? value.call(receiver, store, input, previous)
    : value;
}

function resolveOptionalStepValue(value, receiver, store, input, previous) {
  return value === undefined
    ? undefined
    : resolveStepValue(value, receiver, store, input, previous);
}

function normalizeBranchCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new TypeError("branch(...) requires a non-empty array of cases.");
  }

  return cases.map((entry, index) => normalizeBranchCase(entry, index));
}

function normalizeBranchCase(entry, index) {
  if (Array.isArray(entry)) {
    if (entry.length !== 2) {
      throw new TypeError("branch(...) tuple cases must be [predicate, handler].");
    }

    const [whenFn, thenFn] = entry;
    assertBranchPredicate(whenFn);
    assertBranchHandler(thenFn);
    return {
      default: false,
      when: whenFn,
      then: thenFn
    };
  }

  if (typeof entry === "function") {
    return {
      default: true,
      when: undefined,
      then: entry
    };
  }

  if (isPlainObject(entry)) {
    const isDefault = entry.default === true || !Object.hasOwn(entry, "when");
    const whenFn = entry.when;
    const thenFn = entry.then;

    if (!isDefault) {
      assertBranchPredicate(whenFn);
    }

    assertBranchHandler(thenFn);
    return {
      default: isDefault,
      when: whenFn,
      then: thenFn
    };
  }

  throw new TypeError(`branch(...) case ${index + 1} must be a tuple, object, or default handler.`);
}

function assertBranchPredicate(value) {
  if (typeof value !== "function") {
    throw new TypeError("branch(...) cases require predicate functions.");
  }
}

function assertBranchHandler(value) {
  if (typeof value !== "function") {
    throw new TypeError("branch(...) cases require handler functions.");
  }
}

function normalizeTransitionRules(config) {
  if (Array.isArray(config)) {
    return config.map(normalizeTransitionRule);
  }

  if (isPlainObject(config) && Object.hasOwn(config, "from") && Object.hasOwn(config, "to")) {
    return [normalizeTransitionRule(config)];
  }

  if (isPlainObject(config)) {
    return Object.entries(config).map(([from, to]) => normalizeTransitionRule({
      from,
      to
    }));
  }

  throw new TypeError("transition(...) requires a transition rule object, map, or array.");
}

function normalizeTransitionRule(rule) {
  if (!isPlainObject(rule) || !Object.hasOwn(rule, "to")) {
    throw new TypeError('transition(...) rules require a "to" value.');
  }

  if (Object.hasOwn(rule, "when") && typeof rule.when !== "function") {
    throw new TypeError('transition(...) rule "when" must be a function.');
  }

  const metadata = normalizeMetadataOptions(rule, "transition");

  return {
    from: rule.from,
    to: rule.to,
    when: rule.when,
    ...metadata
  };
}

function transitionRuleMatches(rule, current, store, input, previous) {
  if (rule.from !== undefined && !matchesFrom(rule.from, current)) {
    return false;
  }

  return typeof rule.when !== "function" || Boolean(rule.when(store, input, previous));
}

function matchesFrom(from, current) {
  return Array.isArray(from)
    ? from.some((value) => Object.is(value, current))
    : Object.is(from, current);
}

function resolveStatusName(source, requested) {
  if (typeof requested === "string" && requested.length > 0) {
    return requested;
  }

  const statuses = source?._describe?.().statuses ?? source?.describe?.().statuses ?? [];
  if (statuses.length === 1) {
    return statuses[0];
  }

  throw new Error("Strict Flow helpers require a single status value or an explicit status option.");
}

function copyFlowMetadata(source, target) {
  if (source?.[TRANSITION]) {
    Object.defineProperty(target, TRANSITION, {
      configurable: true,
      value: source[TRANSITION]
    });
  }

  if (source?.[GUARD]) {
    Object.defineProperty(target, GUARD, {
      configurable: true,
      value: source[GUARD]
    });
  }
}

function normalizeMetadataOptions(options, helperName) {
  if (options === undefined) {
    return {};
  }

  if (!isPlainObject(options)) {
    throw new TypeError(`${helperName}(...) metadata options must be an object.`);
  }

  const metadata = {};

  if (Object.hasOwn(options, "reason")) {
    if (typeof options.reason !== "string" || options.reason.length === 0) {
      throw new TypeError(`${helperName}(...) reason must be a non-empty string.`);
    }

    metadata.reason = options.reason;
  }

  if (Object.hasOwn(options, "label")) {
    if (typeof options.label !== "string" || options.label.length === 0) {
      throw new TypeError(`${helperName}(...) label must be a non-empty string.`);
    }

    metadata.label = options.label;
  }

  return metadata;
}
