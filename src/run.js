const RUN_STOP = Symbol("async.flow.run.stop");

export function run(stepOrSteps) {
  const steps = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps];

  for (const step of steps) {
    if (typeof step !== "function") {
      throw new TypeError("run(...) requires a function or an array of functions.");
    }
  }

  return function runner(context) {
    let result;
    let asyncChain = null;

    for (const step of steps) {
      if (asyncChain) {
        asyncChain = asyncChain.then((signal) => {
          if (signal === RUN_STOP) {
            return RUN_STOP;
          }

          return runStepAsync(step, context, (next) => {
            if (isRunStop(next)) {
              return RUN_STOP;
            }

            if (next !== undefined) {
              result = next;
            }

            return undefined;
          });
        });
        continue;
      }

      const next = step(context);

      if (isPromiseLike(next)) {
        asyncChain = Promise.resolve(next).then((resolved) => {
          if (isRunStop(resolved)) {
            return RUN_STOP;
          }

          if (resolved !== undefined) {
            result = resolved;
          }

          return undefined;
        });
        continue;
      }

      if (isRunStop(next)) {
        return result;
      }

      if (next !== undefined) {
        result = next;
      }
    }

    if (!asyncChain) {
      return result;
    }

    return asyncChain.then((next) => (next === RUN_STOP ? result : result));
  };
}

function runStepAsync(step, context, applyResult) {
  const next = step(context);

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

export function createRunStop() {
  return {
    [RUN_STOP]: true
  };
}

export function isRunStop(value) {
  return Boolean(value && typeof value === "object" && value[RUN_STOP] === true);
}
