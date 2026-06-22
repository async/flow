import { defineComputed, defineStatus, isPlainObject } from "./define.js";
import { createComposeStop, isPromiseLike } from "./compose.js";

export const status = defineStatus;

export function set(nameOrUpdates, maybeValue) {
  return function setStep(store) {
    const updates =
      typeof nameOrUpdates === "string"
        ? { [nameOrUpdates]: maybeValue }
        : nameOrUpdates;

    assertUpdateObject(updates, "set");

    for (const [name, value] of Object.entries(updates)) {
      store[name] = value;
    }

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

export function guard(predicate, handler) {
  if (typeof predicate !== "function") {
    throw new TypeError("guard(...) requires a predicate function.");
  }

  if (typeof handler !== "function") {
    throw new TypeError("guard(...) requires a handler function.");
  }

  const guardStep = function guardStep(store, input, previous) {
    if (!predicate.call(this, store, input, previous)) {
      return undefined;
    }

    return handler.call(this, store, input, previous);
  };

  copyFlowMetadata(handler, guardStep);
  return guardStep;
}

export function transition(config, options = {}) {
  const rules = normalizeTransitionRules(config);
  const statusName = options?.status ?? options?.state ?? options?.signal;

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

  Object.defineProperty(transitionStep, "_flowTransition", {
    configurable: true,
    value: {
      status: statusName,
      rules
    }
  });

  return transitionStep;
}

export function can(eventName, options = {}) {
  if (typeof eventName !== "string" || eventName.length === 0) {
    throw new TypeError("can(...) requires a transition handler name.");
  }

  return defineComputed((store, context) => {
    const metadata = context?.describe?.().transitions?.[eventName];
    if (!metadata) {
      return false;
    }

    const name = resolveStatusName(context, options?.status ?? options?.state ?? metadata.status);
    const current = store[name];
    return metadata.rules.some((entry) => transitionRuleMatches(entry, current, store));
  });
}

export function matches(value, options = {}) {
  return defineComputed((store, context) =>
    Object.is(store[resolveStatusName(context, options?.status ?? options?.state ?? options?.signal)], value)
  );
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

  return {
    from: rule.from,
    to: rule.to,
    when: rule.when
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
  if (source?._flowTransition) {
    Object.defineProperty(target, "_flowTransition", {
      configurable: true,
      value: source._flowTransition
    });
  }
}
