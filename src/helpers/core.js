import { COMPUTED, SIGNAL, STATUS, defineComputed, isComputedDefinition, isPlainObject } from "../define.js";
import { FLOW_INSPECT, FLOW_INSTANCE, createComputed as createLiveComputed, createStatus } from "../framework-runtime.js";
import { createComposeStop, isPromiseLike } from "../compose.js";
import {
  AVAILABILITY,
  GUARD,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  STANDALONE_TRANSITION,
  TRANSITION
} from "../protocol.js";

export {
  AVAILABILITY,
  GUARD,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  STANDALONE_TRANSITION,
  TRANSITION
};

export const status = createStatus;

export function set(nameOrUpdates, maybeValue) {
  return function setStep(store, input, previous) {
    if (isWritableSignalLike(nameOrUpdates) || isWritableStatusLike(nameOrUpdates)) {
      nameOrUpdates.set(resolveStepValue(maybeValue, this, store, input, previous));
      return undefined;
    }

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

export function dispatch(targetOrEventName, eventNameOrPayload, maybePayload) {
  if (typeof targetOrEventName === "string") {
    return createStandaloneDispatch(targetOrEventName, eventNameOrPayload, arguments.length >= 2);
  }

  assertEventName(eventNameOrPayload, "dispatch");
  return dispatchToTarget(targetOrEventName, eventNameOrPayload, maybePayload);
}

export function after(ms, eventName, input) {
  assertDelay(ms, "after");

  if (typeof eventName === "function") {
    return createStandaloneAfter(ms, eventName, input);
  }

  assertEventName(eventName, "after");

  return function afterStep(store, currentInput, previous) {
    assertFlowAfterReceiver(this, "after");
    this.after(ms, eventName, resolveOptionalStepValue(input, this, store, currentInput, previous));
    return undefined;
  };
}

export function update(name, fn) {
  if (isWritableSignalLike(name) || isWritableStatusLike(name)) {
    if (typeof fn !== "function") {
      throw new TypeError("update(...) requires an updater function.");
    }

    return function updateRefStep(store, input, previous) {
      name.set(fn(name.get(), store, input, previous));
      return undefined;
    };
  }

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

export function bool(condition) {
  assertCondition(condition, "bool");

  if (isStandaloneBooleanCondition(condition)) {
    return createLiveComputed(() => Boolean(resolveStandaloneCondition(condition)));
  }

  return defineComputed({ arguments: (store) => [store] }, function (store) {
    return Boolean(resolveCondition(condition, this, store, undefined, undefined, "bool"));
  });
}

export function every(...conditions) {
  assertConditionList(conditions, "every");

  if (conditions.every(isStandaloneBooleanCondition)) {
    return createLiveComputed(() =>
      conditions.every((condition) => Boolean(resolveStandaloneCondition(condition)))
    );
  }

  return defineComputed({ arguments: (store) => [store] }, function (store) {
    return conditions.every((condition) =>
      Boolean(resolveCondition(condition, this, store, undefined, undefined, "every"))
    );
  });
}

export function some(...conditions) {
  assertConditionList(conditions, "some");

  if (conditions.every(isStandaloneBooleanCondition)) {
    return createLiveComputed(() =>
      conditions.some((condition) => Boolean(resolveStandaloneCondition(condition)))
    );
  }

  return defineComputed({ arguments: (store) => [store] }, function (store) {
    return conditions.some((condition) =>
      Boolean(resolveCondition(condition, this, store, undefined, undefined, "some"))
    );
  });
}

export function not(condition) {
  assertCondition(condition, "not");

  if (isStandaloneBooleanCondition(condition)) {
    return createLiveComputed(() => !Boolean(resolveStandaloneCondition(condition)));
  }

  return defineComputed({ arguments: (store) => [store] }, function (store) {
    return !Boolean(resolveCondition(condition, this, store, undefined, undefined, "not"));
  });
}

export function when(predicate, options) {
  const condition = createConditionPredicate(predicate, "when");
  const availability = normalizeAvailabilityOptions(options, "when");

  const whenStep = function whenStep(store, input, previous) {
    return condition.call(this, store, input, previous) ? undefined : createComposeStop();
  };

  if (availability.enabled) {
    Object.defineProperty(whenStep, AVAILABILITY, {
      configurable: true,
      value: {
        predicate: condition,
        ...availability.metadata
      }
    });
  }

  return whenStep;
}

export function branch(cases) {
  const normalized = normalizeBranchCases(cases);

  return function branchStep(store, input, previous) {
    for (const entry of normalized) {
      if (entry.default || entry.condition.call(this, store, input, previous)) {
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
  if (typeof handler !== "function") {
    throw new TypeError("guard(...) requires a handler function.");
  }

  const condition = createConditionPredicate(predicate, "guard");
  const metadata = normalizeMetadataOptions(options, "guard");

  const guardStep = function guardStep(store, input, previous) {
    if (!condition.call(this, store, input, previous)) {
      return undefined;
    }

    return handler.call(this, store, input, previous);
  };

  copyFlowMetadata(handler, guardStep);
  Object.defineProperty(guardStep, GUARD, {
    configurable: true,
    value: {
      predicate: condition,
      ...metadata
    }
  });
  return guardStep;
}

export function transition(statusTarget, config) {
  assertStatusTarget(statusTarget, "transition");
  const rules = normalizeTransitionRules(config);

  const transitionStep = function transitionStep(store, input, previous) {
    const target = resolveTransitionTarget(this, store, statusTarget);
    const targetStore = target.store ?? store;
    const current = target.get();
    const rule = rules.find((entry) => transitionRuleMatches(entry, current, this, targetStore, input, previous));

    if (!rule) {
      return undefined;
    }

    target.set(typeof rule.to === "function"
      ? rule.to.call(this, targetStore, input, previous)
      : rule.to);
    return undefined;
  };

  if (typeof statusTarget === "string") {
    Object.defineProperty(transitionStep, TRANSITION, {
      configurable: true,
      value: {
        status: statusTarget,
        rules
      }
    });
  } else {
    Object.defineProperty(transitionStep, STANDALONE_TRANSITION, {
      configurable: true,
      value: {
        target: statusTarget,
        rules
      }
    });
  }

  return transitionStep;
}

export function can(statusNameOrFlowOrEventName, eventName, input) {
  if (isStandaloneTransition(statusNameOrFlowOrEventName)) {
    return createLiveComputed(() => canRunStandaloneTransition(statusNameOrFlowOrEventName, eventName));
  }

  if (isFlowLike(statusNameOrFlowOrEventName)) {
    assertEventName(eventName, "can");
    return createLiveComputed(() => Boolean(statusNameOrFlowOrEventName.explain(eventName, input)?.allowed));
  }

  if (arguments.length === 1) {
    assertEventName(statusNameOrFlowOrEventName, "can");
    return defineComputed({ arguments: (store) => [store] }, function (store) {
      return Boolean(this.explain?.(statusNameOrFlowOrEventName, undefined, store)?.allowed);
    });
  }

  assertStatusName(statusNameOrFlowOrEventName, "can");
  if (typeof eventName !== "string" || eventName.length === 0) {
    throw new TypeError("can(...) requires an event name.");
  }

  return defineComputed({ arguments: (store) => [store] }, function (store) {
    const explanation = this.explain?.(eventName, undefined, store, {
      statusName: statusNameOrFlowOrEventName
    });

    return Boolean(explanation?.allowed);
  });
}

export function matches(statusNameOrRef, value) {
  if (isSignalLike(statusNameOrRef) || isStatusLike(statusNameOrRef)) {
    return createLiveComputed(() => valueMatches(statusNameOrRef.get(), value));
  }

  assertStatusName(statusNameOrRef, "matches");
  return defineComputed({ arguments: (store) => [store] }, function (store) {
    const current = store[resolveStatusName(this, statusNameOrRef)];
    return valueMatches(current, value);
  });
}

export function inspect(target) {
  if (isFlowLike(target) && typeof target[FLOW_INSPECT] === "function") {
    return target[FLOW_INSPECT]();
  }

  if (isStandaloneDispatch(target)) {
    return inspectStandaloneDispatch(target);
  }

  if (isStandaloneAfter(target)) {
    return inspectStandaloneAfter(target);
  }

  if (isStandaloneTransition(target)) {
    return inspectStandaloneTransition(target);
  }

  if (typeof target === "function" && target[TRANSITION]) {
    return inspectNamedTransition(target);
  }

  if (isStatusLike(target)) {
    return inspectRef(target, "status");
  }

  if (isSignalLike(target)) {
    return inspectRef(target, "signal");
  }

  if (isComputedLike(target)) {
    return {
      type: "computed",
      value: cloneInspectable(target.get())
    };
  }

  throw new TypeError(
    "inspect(...) requires a Flow instance, status ref, signal ref, computed ref, dispatch helper, transition helper, or timer helper."
  );
}

function createConditionPredicate(condition, helperName) {
  assertCondition(condition, helperName);

  return function conditionPredicate(store, input, previous) {
    return Boolean(resolveCondition(condition, this, store, input, previous, helperName));
  };
}

function resolveCondition(condition, receiver, store, input, previous, helperName) {
  if (typeof condition === "function") {
    return condition.call(receiver, store, input, previous);
  }

  if (isComputedDefinition(condition)) {
    const args = resolveConditionArguments(condition.options?.arguments, store, helperName);
    const conditionReceiver = createConditionReceiver(receiver);
    return condition.compute.apply(conditionReceiver, args);
  }

  if (isComputedLike(condition)) {
    return condition.get();
  }

  if (isSignalLike(condition) || isStatusLike(condition)) {
    return condition.get();
  }

  throw new TypeError(`${helperName}(...) requires a boolean condition.`);
}

function createConditionReceiver(receiver) {
  const conditionReceiver = Object.create(receiver ?? null);
  return conditionReceiver;
}

function resolveConditionArguments(configured, store, helperName) {
  if (configured === undefined) {
    return [];
  }

  if (Array.isArray(configured)) {
    return [...configured];
  }

  if (typeof configured === "function") {
    const resolved = configured(store);
    if (!Array.isArray(resolved)) {
      throw new TypeError(`${helperName}(...) condition options.arguments function must return an array.`);
    }

    return [...resolved];
  }

  throw new TypeError(`${helperName}(...) condition options.arguments must be an array or function when provided.`);
}

function assertConditionList(conditions, helperName) {
  if (conditions.length === 0) {
    throw new TypeError(`${helperName}(...) requires at least one boolean condition.`);
  }

  for (const condition of conditions) {
    assertCondition(condition, helperName);
  }
}

function assertCondition(condition, helperName) {
  if (
    typeof condition === "function" ||
    isComputedDefinition(condition) ||
    isComputedLike(condition) ||
    isSignalLike(condition) ||
    isStatusLike(condition)
  ) {
    return;
  }

  throw new TypeError(`${helperName}(...) requires a boolean condition.`);
}

function assertStatusName(value, helperName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${helperName}(...) requires a status name.`);
  }
}

function assertStatusTarget(value, helperName) {
  if ((typeof value === "string" && value.length > 0) || isWritableSignalLike(value) || isWritableStatusLike(value)) {
    return;
  }

  throw new TypeError(`${helperName}(...) requires a status name or signal ref.`);
}

function createStandaloneDispatch(eventName, configuredPayload, hasConfiguredPayload) {
  assertEventName(eventName, "dispatch");
  const metadata = {
    event: eventName,
    payload: hasConfiguredPayload
  };
  const dispatchStep = function standaloneDispatchStep() {};

  return new Proxy(dispatchStep, {
    apply(_target, thisArg, args) {
      const hasComposeArguments = args.length >= 2;
      const hasOverridePayload = !hasComposeArguments && args.length >= 1;
      const payload = hasOverridePayload ? args[0] : configuredPayload;
      const resolvedPayload = resolveDeferredDispatchPayload(
        payload,
        thisArg,
        hasComposeArguments ? args[0] : undefined,
        hasComposeArguments ? args[1] : undefined,
        hasComposeArguments ? args[2] : undefined
      );

      return dispatchToTarget(thisArg, eventName, resolvedPayload);
    },

    get(target, prop, receiver) {
      if (prop === STANDALONE_DISPATCH) {
        return metadata;
      }

      if (prop === "send" || prop === "emit") {
        return function dispatchFromTarget(targetObject, overridePayload) {
          const payload = arguments.length >= 2 ? overridePayload : configuredPayload;
          return dispatchToTarget(
            targetObject,
            eventName,
            resolveDeferredDispatchPayload(payload, targetObject, undefined, undefined, undefined)
          );
        };
      }

      return Reflect.get(target, prop, receiver);
    }
  });
}

function dispatchToTarget(target, eventName, payload) {
  if (isFlowDispatchTarget(target)) {
    return target.dispatch(eventName, payload);
  }

  if (isDomDispatchTarget(target)) {
    return dispatchDomEvent(target, eventName, payload);
  }

  if (isEmitterTarget(target)) {
    return target.emit(eventName, payload);
  }

  if (isSenderTarget(target)) {
    return target.send(eventName, payload);
  }

  return false;
}

function dispatchDomEvent(target, eventName, payload) {
  const EventConstructor = globalThis.Event;
  const CustomEventConstructor = globalThis.CustomEvent;

  if (payload === undefined) {
    if (typeof EventConstructor !== "function") {
      return false;
    }

    return dispatchDomEventObject(
      target,
      new EventConstructor(eventName, {
        bubbles: true,
        composed: true
      })
    );
  }

  if (typeof CustomEventConstructor !== "function") {
    return false;
  }

  return dispatchDomEventObject(
    target,
    new CustomEventConstructor(eventName, {
      bubbles: true,
      composed: true,
      detail: payload
    })
  );
}

function dispatchDomEventObject(target, event) {
  Object.defineProperty(event, STANDALONE_DISPATCH, {
    configurable: true,
    value: true
  });

  return target.dispatchEvent(event);
}

function resolveDeferredDispatchPayload(payload, receiver, store, input, previous) {
  return typeof payload === "function"
    ? payload.call(receiver, store, input, previous)
    : payload;
}

function createStandaloneAfter(ms, task, configuredInput) {
  const afterStep = function standaloneAfterStep(input) {
    const receiver = this;
    const scheduledInput = configuredInput === undefined ? input : configuredInput;
    let unregister;
    const timeout = setTimeout(() => {
      unregister?.();

      try {
        const result = task.call(receiver, scheduledInput);

        if (isPromiseLike(result)) {
          Promise.resolve(result).catch(sinkAsyncError);
        }
      } catch (error) {
        sinkAsyncError(error);
      }
    }, ms);
    const cleanup = () => clearTimeout(timeout);

    if (typeof receiver?.dispose === "function") {
      unregister = receiver.dispose(cleanup);
    }

    return undefined;
  };

  Object.defineProperty(afterStep, STANDALONE_AFTER, {
    configurable: true,
    value: {
      ms
    }
  });

  return afterStep;
}

function sinkAsyncError() {}

function assertEventName(value, helperName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${helperName}(...) requires an event name.`);
  }
}

function valueMatches(current, value) {
  return Array.isArray(value)
    ? value.some((entry) => Object.is(current, entry))
    : Object.is(current, value);
}

function isFlowLike(value) {
  return Boolean(value && typeof value === "object" && value[FLOW_INSTANCE] && typeof value.explain === "function");
}

function isFlowDispatchTarget(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value[FLOW_INSTANCE] &&
    typeof value.dispatch === "function"
  );
}

function isDomDispatchTarget(value) {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.dispatchEvent === "function"
  );
}

function isEmitterTarget(value) {
  return Boolean(
    value &&
    !isStandaloneDispatch(value) &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.emit === "function"
  );
}

function isSenderTarget(value) {
  return Boolean(
    value &&
    !isStandaloneDispatch(value) &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.send === "function"
  );
}

function isComputedLike(value) {
  return Boolean(value && typeof value === "object" && value[COMPUTED] && typeof value.get === "function");
}

function isSignalLike(value) {
  return Boolean(value && typeof value === "object" && value[SIGNAL] && typeof value.get === "function");
}

function isStatusLike(value) {
  return Boolean(value && typeof value === "object" && value[STATUS] && typeof value.get === "function");
}

function isStandaloneTransition(value) {
  return Boolean(typeof value === "function" && value[STANDALONE_TRANSITION]);
}

function isStandaloneDispatch(value) {
  return Boolean(typeof value === "function" && value[STANDALONE_DISPATCH]);
}

function isStandaloneAfter(value) {
  return Boolean(typeof value === "function" && value[STANDALONE_AFTER]);
}

function isStandaloneBooleanCondition(value) {
  return isComputedLike(value) || isSignalLike(value) || isStatusLike(value);
}

function resolveStandaloneCondition(condition) {
  return condition.get();
}

function canRunStandaloneTransition(transitionStep, input) {
  const metadata = transitionStep[STANDALONE_TRANSITION];
  const current = metadata.target.get();
  return metadata.rules.some((rule) =>
    transitionRuleMatches(rule, current, undefined, undefined, input, undefined)
  );
}

function inspectStandaloneTransition(transitionStep) {
  const metadata = transitionStep[STANDALONE_TRANSITION];

  return {
    type: "transition",
    target: inspectRef(metadata.target, isStatusLike(metadata.target) ? "status" : "signal"),
    rules: metadata.rules.map(inspectTransitionRule)
  };
}

function inspectStandaloneDispatch(dispatchStep) {
  const metadata = dispatchStep[STANDALONE_DISPATCH];

  return {
    type: "dispatch",
    event: metadata.event,
    payload: metadata.payload
  };
}

function inspectStandaloneAfter(afterStep) {
  const metadata = afterStep[STANDALONE_AFTER];

  return {
    type: "after",
    ms: metadata.ms
  };
}

function inspectNamedTransition(transitionStep) {
  const metadata = transitionStep[TRANSITION];

  return {
    type: "transition",
    status: metadata.status,
    rules: metadata.rules.map(inspectTransitionRule)
  };
}

function inspectRef(ref, type) {
  const description = {
    type,
    value: cloneInspectable(ref.get())
  };

  if (type === "status" && Array.isArray(ref.allowed)) {
    description.allowed = cloneInspectable(ref.allowed);
  }

  return description;
}

function inspectTransitionRule(rule) {
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

function isWritableSignalLike(value) {
  return isSignalLike(value) && typeof value.set === "function";
}

function isWritableStatusLike(value) {
  return isStatusLike(value) && typeof value.set === "function";
}

function resolveTransitionTarget(receiver, store, statusTarget) {
  if (isWritableSignalLike(statusTarget) || isWritableStatusLike(statusTarget)) {
    return {
      get: () => statusTarget.get(),
      set: (value) => statusTarget.set(value),
      store
    };
  }

  const name = resolveStatusName(receiver, statusTarget);
  const targetStore = resolveTransitionStore(receiver, store);

  return {
    get: () => targetStore[name],
    set: (value) => {
      targetStore[name] = value;
    },
    store: targetStore
  };
}

function resolveTransitionStore(receiver, store) {
  if (store && typeof store === "object") {
    return store;
  }

  if (isFlowLike(receiver) && receiver.store && typeof receiver.store === "object") {
    return receiver.store;
  }

  throw new TypeError("transition(...) requires a store object when used with a status name.");
}

function assertDelay(value, helperName) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${helperName}(...) requires a non-negative millisecond delay.`);
  }
}

function assertFlowAfterReceiver(receiver, helperName) {
  if (!isFlowLike(receiver) || typeof receiver.after !== "function") {
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
      throw new TypeError("branch(...) tuple cases must be [condition, handler].");
    }

    const [whenFn, thenFn] = entry;
    assertBranchCondition(whenFn);
    assertBranchHandler(thenFn);
    return {
      default: false,
      condition: createConditionPredicate(whenFn, "branch"),
      then: thenFn
    };
  }

  if (typeof entry === "function") {
    return {
      default: true,
      then: entry
    };
  }

  if (isPlainObject(entry)) {
    const isDefault = entry.default === true || !Object.hasOwn(entry, "when");
    const whenFn = entry.when;
    const thenFn = entry.then;

    if (!isDefault) {
      assertBranchCondition(whenFn);
    }

    assertBranchHandler(thenFn);
    return {
      default: isDefault,
      condition: isDefault ? undefined : createConditionPredicate(whenFn, "branch"),
      then: thenFn
    };
  }

  throw new TypeError(`branch(...) case ${index + 1} must be a tuple, object, or default handler.`);
}

function assertBranchCondition(value) {
  try {
    assertCondition(value, "branch");
  } catch {
    throw new TypeError("branch(...) cases require boolean conditions.");
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

  if (Object.hasOwn(rule, "when")) {
    try {
      assertCondition(rule.when, "transition");
    } catch {
      throw new TypeError('transition(...) rule "when" must be a boolean condition.');
    }
  }

  const metadata = normalizeMetadataOptions(rule, "transition");

  return {
    from: rule.from,
    to: rule.to,
    when: Object.hasOwn(rule, "when") ? createConditionPredicate(rule.when, "transition") : undefined,
    ...metadata
  };
}

function transitionRuleMatches(rule, current, receiver, store, input, previous) {
  if (rule.from !== undefined && !matchesFrom(rule.from, current)) {
    return false;
  }

  return typeof rule.when !== "function" || Boolean(rule.when.call(receiver, store, input, previous));
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

  const statuses = statusNamesFromInspection(source);
  if (statuses.length === 1) {
    return statuses[0];
  }

  throw new Error("Strict Flow helpers require a single status value or an explicit status option.");
}

function statusNamesFromInspection(source) {
  const description = typeof source?.[FLOW_INSPECT] === "function" ? source[FLOW_INSPECT]() : undefined;
  if (!description?.store || typeof description.store !== "object") {
    return [];
  }

  return Object.entries(description.store)
    .filter(([, entry]) => entry?.type === "status")
    .map(([name]) => name);
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

  if (source?.[AVAILABILITY]) {
    Object.defineProperty(target, AVAILABILITY, {
      configurable: true,
      value: source[AVAILABILITY]
    });
  }

}

function normalizeAvailabilityOptions(options, helperName) {
  if (options === undefined) {
    return {
      enabled: false,
      metadata: {}
    };
  }

  if (!isPlainObject(options)) {
    throw new TypeError(`${helperName}(...) options must be an object.`);
  }

  if (Object.hasOwn(options, "availability") && typeof options.availability !== "boolean") {
    throw new TypeError(`${helperName}(...) availability must be a boolean.`);
  }

  return {
    enabled: options.availability === true,
    metadata: normalizeMetadataOptions(options, helperName)
  };
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
