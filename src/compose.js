const COMPOSE_STOP = Symbol("async.flow.compose.stop");

export function compose(stepOrSteps) {
  const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];

  for (const step of steps) {
    if (typeof step !== "function") {
      throw new TypeError("compose(...) requires a function or an array of functions.");
    }
  }

  return function composed(store, input) {
    let previous;
    let asyncChain = null;

    for (const step of steps) {
      if (asyncChain) {
        asyncChain = asyncChain.then((signal) => {
          if (signal === COMPOSE_STOP) {
            return COMPOSE_STOP;
          }

          return runStepAsync(this, step, store, input, previous, (next) => {
            if (isComposeStop(next)) {
              return COMPOSE_STOP;
            }

            if (next !== undefined) {
              previous = next;
            }

            return undefined;
          });
        });
        continue;
      }

      const next = step.call(this, store, input, previous);

      if (isPromiseLike(next)) {
        asyncChain = Promise.resolve(next).then((resolved) => {
          if (isComposeStop(resolved)) {
            return COMPOSE_STOP;
          }

          if (resolved !== undefined) {
            previous = resolved;
          }

          return undefined;
        });
        continue;
      }

      if (isComposeStop(next)) {
        return previous;
      }

      if (next !== undefined) {
        previous = next;
      }
    }

    if (!asyncChain) {
      return previous;
    }

    return asyncChain.then(() => previous);
  };
}

function runStepAsync(receiver, step, store, input, previous, applyResult) {
  const next = step.call(receiver, store, input, previous);

  if (isPromiseLike(next)) {
    return Promise.resolve(next).then(applyResult);
  }

  return applyResult(next);
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
