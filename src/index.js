import { createFlow } from "./runtime.js";

export {
  defineFlow,
  defineSignal,
  defineStatus,
  defineComputed,
  defineAsyncSignal,
  SIGNAL,
  STATUS,
  COMPUTED,
  ASYNC_SIGNAL,
  ASYNC_SIGNAL_IMMEDIATE,
  defineSignal as signal,
  defineComputed as computed,
  defineAsyncSignal as asyncSignal,
  isAsyncSignal,
  isAsyncSignalDefinition,
  isImmediateAsyncSignal
} from "./define.js";
export {
  createFlow,
  createStore,
  createSignal,
  createStatus,
  createComputed,
  createAsyncSignal,
  FLOW_INSTANCE,
  FLOW_INSPECT
} from "./runtime.js";
export {
  compose,
  parallel,
  remember,
  isPromiseLike
} from "./compose.js";
export {
  set,
  update,
  dispatch,
  after,
  bool,
  every,
  some,
  not,
  when,
  branch,
  onError,
  AVAILABILITY,
  TRANSITION,
  GUARD,
  STANDALONE_TRANSITION,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  status,
  guard,
  transition,
  can,
  matches,
  inspect
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
