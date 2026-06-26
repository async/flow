import {
  createAsyncSignal as createAsyncSignalCore,
  createComputed as createComputedCore,
  createFlow as createFlowCore,
  createSignal as createSignalCore,
  createStatus as createStatusCore,
  createStore as createStoreCore
} from "./framework-runtime.js";
import { isAsyncSignalDefinition } from "./define.js";
import { resolveScheduler } from "./scheduler.js";

export {
  FLOW_INSPECT,
  FLOW_INSTANCE
} from "./framework-runtime.js";

export function createSignal(initial, options = {}) {
  return createSignalCore(initial, withDefaultScheduler(options));
}

export function createStatus(initial, allowed, options = {}) {
  return createStatusCore(initial, allowed, withDefaultScheduler(options));
}

export function createComputed(optionsOrCompute, maybeCompute, maybeRuntimeOptions) {
  if (typeof optionsOrCompute === "function") {
    return createComputedCore(optionsOrCompute, withDefaultScheduler(maybeCompute));
  }

  return createComputedCore(optionsOrCompute, maybeCompute, withDefaultScheduler(maybeRuntimeOptions));
}

export function createAsyncSignal(optionsOrLoader, maybeLoader, maybeRuntimeOptions) {
  if (isAsyncSignalDefinition(optionsOrLoader) || typeof optionsOrLoader === "function") {
    return createAsyncSignalCore(optionsOrLoader, withDefaultScheduler(maybeLoader));
  }

  return createAsyncSignalCore(optionsOrLoader, maybeLoader, withDefaultScheduler(maybeRuntimeOptions));
}

export function createStore(declarations = {}, options = {}) {
  return createStoreCore(declarations, withDefaultScheduler(options));
}

export function createFlow(definitionOrConfig, options = {}) {
  return createFlowCore(definitionOrConfig, withDefaultSchedulerForRuntime(options));
}

function withDefaultScheduler(options) {
  const normalized = isPlainObject(options) ? options : {};
  return {
    ...normalized,
    scheduler: resolveScheduler(normalized)
  };
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function withDefaultSchedulerForRuntime(options) {
  if (options !== undefined && !isPlainObject(options)) {
    return options;
  }

  return withDefaultScheduler(options);
}
