const COMPOSE_STOP = Symbol("async.flow.compose.stop");
export const COMPOSE_BATCH = Symbol.for("@async/flow.compose.batch");

export function compose(stepOrSteps) {
  const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];

  for (const step of steps) {
    if (typeof step !== "function") {
      throw new TypeError("compose(...) requires a function or an array of functions.");
    }
  }

  return function composed(store, input) {
    const receiver = this;
    let previous;
    let index = 0;

    return runSegment(false);

    function runSegment(batchContinuation) {
      const execute = () => {
        while (index < steps.length) {
          const next = steps[index].call(receiver, store, input, previous);
          index += 1;

          if (isPromiseLike(next)) {
            return Promise.resolve(next).then((resolved) => {
              if (applyStepResult(resolved) === COMPOSE_STOP) {
                return previous;
              }

              return runSegment(true);
            });
          }

          if (applyStepResult(next) === COMPOSE_STOP) {
            return previous;
          }
        }

        return previous;
      };

      const batch = batchContinuation ? receiver?.[COMPOSE_BATCH] : undefined;
      return typeof batch === "function" ? batch.call(receiver, execute) : execute();
    }

    function applyStepResult(next) {
      if (isComposeStop(next)) {
        return COMPOSE_STOP;
      }

      if (next !== undefined) {
        previous = next;
      }

      return undefined;
    }
  };
}

export function isPromiseLike(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function"
  );
}

export function createComposeStop() {
  return {
    [COMPOSE_STOP]: true
  };
}

export function isComposeStop(value) {
  return Boolean(value && typeof value === "object" && value[COMPOSE_STOP] === true);
}
