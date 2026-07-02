import { FLOW_INSPECT, FLOW_INSTANCE, createComputed, createStatus } from "./runtime.js";
import { createHelperExports } from "./helpers/shared.js";

export {
  AVAILABILITY,
  GUARD,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  STANDALONE_TRANSITION,
  TRANSITION
} from "./protocol.js";

const helpers = createHelperExports({
  FLOW_INSPECT,
  FLOW_INSTANCE,
  createComputed,
  createStatus
});

export const status = helpers.status;
export const set = helpers.set;
export const dispatch = helpers.dispatch;
export const after = helpers.after;
export const update = helpers.update;
export const bool = helpers.bool;
export const every = helpers.every;
export const some = helpers.some;
export const not = helpers.not;
export const when = helpers.when;
export const branch = helpers.branch;
export const onError = helpers.onError;
export const guard = helpers.guard;
export const transition = helpers.transition;
export const can = helpers.can;
export const matches = helpers.matches;
export const inspect = helpers.inspect;
