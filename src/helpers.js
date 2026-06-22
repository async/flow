import { defineComputed, defineState, isPlainObject } from "./define.js";
import { createRunStop, isPromiseLike } from "./run.js";

export const state = defineState;

export function set(nameOrUpdates, maybeValue) {
  return function setStep(context) {
    const updates =
      typeof nameOrUpdates === "string"
        ? { [nameOrUpdates]: maybeValue }
        : nameOrUpdates;

    assertUpdateObject(updates, "set");

    for (const [name, value] of Object.entries(updates)) {
      context.signals[name] = value;
    }

    return undefined;
  };
}

export function update(name, fn) {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("update(...) requires a signal name.");
  }

  if (typeof fn !== "function") {
    throw new TypeError("update(...) requires an updater function.");
  }

  return function updateStep(context) {
    context.signals[name] = fn(context.signals[name], context);
    return undefined;
  };
}

export function when(predicate) {
  if (typeof predicate !== "function") {
    throw new TypeError("when(...) requires a predicate function.");
  }

  return function whenStep(context) {
    return predicate(context) ? undefined : createRunStop();
  };
}

export function onError(handle, handler) {
  if (typeof handle !== "function") {
    throw new TypeError("onError(...) requires an error handler function.");
  }

  if (typeof handler !== "function") {
    throw new TypeError("onError(...) requires a handler function.");
  }

  const onErrorStep = function onErrorStep(context) {
    try {
      const result = handler(context);

      if (isPromiseLike(result)) {
        return Promise.resolve(result).catch((error) => handle(error, context));
      }

      return result;
    } catch (error) {
      return handle(error, context);
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

  const guardStep = function guardStep(context) {
    if (!predicate(context)) {
      return undefined;
    }

    return handler(context);
  };

  copyFlowMetadata(handler, guardStep);
  return guardStep;
}

export function transition(config, options = {}) {
  const rules = normalizeTransitionRules(config);
  const stateName = options?.state ?? options?.signal;

  const transitionStep = function transitionStep(context) {
    const name = resolveStateName(context, stateName);
    const current = context.signals[name];
    const rule = rules.find((entry) => transitionRuleMatches(entry, current, context));

    if (!rule) {
      return undefined;
    }

    context.signals[name] = typeof rule.to === "function"
      ? rule.to(context)
      : rule.to;
    return undefined;
  };

  Object.defineProperty(transitionStep, "_flowTransition", {
    configurable: true,
    value: {
      state: stateName,
      rules
    }
  });

  return transitionStep;
}

export function can(eventName, options = {}) {
  if (typeof eventName !== "string" || eventName.length === 0) {
    throw new TypeError("can(...) requires a transition handler name.");
  }

  return defineComputed((context) => {
    const metadata = context.flow._describe?.().transitions?.[eventName];
    if (!metadata) {
      return false;
    }

    const name = resolveStateName(context, options?.state ?? metadata.state);
    const current = context.signals[name];
    return metadata.rules.some((entry) => transitionRuleMatches(entry, current, context));
  });
}

export function matches(value, options = {}) {
  return defineComputed((context) =>
    Object.is(context.signals[resolveStateName(context, options?.state ?? options?.signal)], value)
  );
}

function assertUpdateObject(value, helperName) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${helperName}(...) requires a signal update object.`);
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

function transitionRuleMatches(rule, current, context) {
  if (rule.from !== undefined && !matchesFrom(rule.from, current)) {
    return false;
  }

  return typeof rule.when !== "function" || Boolean(rule.when(context));
}

function matchesFrom(from, current) {
  return Array.isArray(from)
    ? from.some((value) => Object.is(value, current))
    : Object.is(from, current);
}

function resolveStateName(context, requested) {
  if (typeof requested === "string" && requested.length > 0) {
    return requested;
  }

  const states = context.flow._describe?.().states ?? [];
  if (states.length === 1) {
    return states[0];
  }

  throw new Error("Strict Flow helpers require a single state signal or an explicit state option.");
}

function copyFlowMetadata(source, target) {
  if (source?._flowTransition) {
    Object.defineProperty(target, "_flowTransition", {
      configurable: true,
      value: source._flowTransition
    });
  }
}
