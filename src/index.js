import { createFlow } from "./runtime.js";

export {
  defineFlow,
  defineSignal,
  defineStatus,
  defineComputed,
  defineResource,
  SIGNAL,
  STATUS,
  COMPUTED,
  RESOURCE,
  RESOURCE_IMMEDIATE,
  defineSignal as signal,
  defineComputed as computed,
  defineStatus as status,
  defineResource as resource,
  isResource,
  isImmediateResource
} from "./define.js";
export {
  createFlow,
  createStore,
  createSignal,
  createStatus,
  createComputed,
  createResource
} from "./runtime.js";
export {
  compose,
  isPromiseLike
} from "./compose.js";
export {
  set,
  update,
  when,
  onError,
  TRANSITION,
  GUARD,
  status as statusHelper,
  guard,
  transition,
  can,
  matches
} from "./helpers.js";
export {
  createDefaultScheduler,
  defaultScheduler,
  getDefaultScheduler,
  resetDefaultScheduler,
  setDefaultScheduler
} from "./scheduler.js";

export function flow(optionsOrConfig, maybeConfig) {
  if (arguments.length === 1) {
    return createFlow(optionsOrConfig);
  }

  return createFlow(maybeConfig, optionsOrConfig);
}
