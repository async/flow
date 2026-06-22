import { createFlow } from "./runtime.js";

export {
  defineFlow,
  defineSignal,
  defineState,
  defineComputed,
  defineAsyncSignal,
  defineSignal as signal,
  defineComputed as computed,
  defineAsyncSignal as asyncSignal
} from "./define.js";
export {
  createFlow,
  createSignal,
  createComputed,
  createAsyncSignal
} from "./runtime.js";
export {
  run,
  isPromiseLike
} from "./run.js";
export {
  set,
  update,
  when,
  onError,
  state,
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

export function flow(config, options) {
  return createFlow(config, options);
}
